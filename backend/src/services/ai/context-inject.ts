/**
 * 上下文注入(日期 / 记忆 / 技能)—— 只在「与已注入内容有差异」时追加一条注入消息。
 *
 * 为什么不再拼进系统提示词:
 * 前缀缓存(DeepSeek 上下文缓存等)要求「已发送过的前缀逐字节不变」。这些内容会变
 * (跨天、记忆增删、技能触发),一旦放在系统提示词里,它们变化后其后的整段历史都会缓存失效,
 * 长会话里这是最大的一笔浪费。改成按需追加到对话尾部后,变化只影响新追加的那一条。
 *
 * 落库与重放(关键约束,勿破坏):
 * 注入写成 role='inject' 的消息,并用 parentMessageId 绑定它所属的用户消息;构建请求时
 * 再折叠回该用户消息的文本。两个请求装配路径(chat.ts 的 buildChatMessages 与主消息流程)
 * 必须使用同一套折叠规则 —— 否则下一轮从 DB 重建历史时文本不一致,前缀照样失效。
 */
import { prisma } from '../../app.js'
import { MEMORY_TYPE_LABELS, type ChatInjection, type InjectionSummary } from '@homibook/core'
import { estimateTokens } from './token-estimate.js'

/** 注入消息的角色标记(存 ChatMessage.role;对外消息接口需过滤,避免渲染成用户消息) */
export const INJECT_ROLE = 'inject'

/** 注入前缀:提醒模型这是系统追加的上下文,而不是用户自己说的话 */
const INJECT_PREFIX = '[系统追加的上下文,仅供你参考,不要在回复中复述]'

/** 记忆段标题(与 summarizeInjection 成对维护:改这里要同步改解析与单测) */
const MEMORY_HEADING = '以下是用户的长期记忆(供参考):'

/** 附件清单段标记(格式约定集中在本模块,避免 chat.ts 与解析逻辑各写一份) */
const ATTACHMENT_MARK = '[附件信息]'

/**
 * 附件清单末尾的说明:告诉模型 attachmentId 就是这些文件的**唯一标识**,图片识别/账单导入/流水关联都用它
 * (两个上传入口都产出 RecordAttachment,导入链路已统一到 attachmentId,fileId 已废弃)。
 *
 * 措辞**刻意避开** import-transactions 的触发标记(即「请导入」):detectSkills 的入参是
 * 「用户原文 + 本段」,这里出现该标记会让每条带附件的消息都激活导入技能。
 */
const ATTACHMENT_SCOPE_NOTE =
  '说明:以上 attachmentId 是这些附件在系统里的唯一标识 —— 图片识别、账单导入、流水附件关联都用它;调用工具时直接引用,不要用文件名或其它 id。' +
  '图片的「内容摘要/识别文本/关键信息」是系统预先读出的文字内容:后续轮次凭这些文字作答即可,不要重复识别;' +
  '仅当用户追问图片的视觉细节(版面排版、位置、印章、商品外观等)时,才调用 view_image(把要确认的细节写进 question),由视觉模型看图后作答。'

/**
 * 多模态主模型场景:本轮图片**以图像形式直接下发**,没有预提取的文字。
 * 这里不能再写「系统已预先读出文字」,否则模型会以为自己拿到了摘要而跳过看图。
 * 措辞对后续轮次同样成立(首轮之后历史里只剩这段文字,追问细节要靠 view_image)。
 */
const ATTACHMENT_SCOPE_NOTE_DIRECT =
  '说明:以上 attachmentId 是这些附件在系统里的唯一标识 —— 图片识别、账单导入、流水附件关联都用它;调用工具时直接引用,不要用文件名或其它 id。' +
  '本轮图片已作为图像随消息提供,请直接看图作答,不要调用 ocr_receipt 重复识别。' +
  '回答前请先对每张图片调用一次 save_image_content,把你看到的内容(摘要/图中文字/关键字段)记下来 —— 后续轮次凭它记得图片;' +
  '若需要确认视觉细节(版面排版、位置、印章、商品外观等),调用 view_image(把要确认的细节写进 question)。'

/** 图片文字化结果的最小形状(完整定义见 services/ai/image-context.ts;此处只取用得到的字段) */
export interface AttachmentTextContext {
  summary: string
  text: string
  meta: Record<string, unknown> | null
}

/** 注入段里的正文上限:够模型「记得」即可,细节留给 view_image */
const ATTACHMENT_TEXT_LIMIT = 600

/**
 * 构造附件清单注入段(空数组返回空串,表示本轮不注入)。
 *
 * 带 contexts 时会把图片的**文字化结果**一并写入 —— 这段文本会随注入消息落库,
 * 所以后续轮次从 DB 重放历史时模型仍「记得」图片内容(图片本体只在首轮以 base64 下发)。
 */
export function buildAttachmentSection(
  attachments: { id: string; originalFilename: string }[],
  contexts?: Map<string, AttachmentTextContext>,
  /** 多模态主模型本轮直读图片(没有预提取摘要)时置 true,换用「看图作答」的措辞 */
  directImageVision = false,
): string {
  if (attachments.length === 0) return ''
  const lines = attachments.map((a) => {
    const head = `attachmentId: ${a.id}\n文件名: ${a.originalFilename}`
    const ctx = contexts?.get(a.id)
    if (!ctx) return head
    const parts = [head, `内容摘要: ${oneLine(ctx.summary)}`]
    if (ctx.text) parts.push(`识别文本: ${oneLine(ctx.text, ATTACHMENT_TEXT_LIMIT)}`)
    if (ctx.meta && Object.keys(ctx.meta).length > 0) parts.push(`关键信息: ${JSON.stringify(ctx.meta)}`)
    return parts.join('\n')
  })
  return `${ATTACHMENT_MARK}\n${lines.join('\n')}\n${directImageVision ? ATTACHMENT_SCOPE_NOTE_DIRECT : ATTACHMENT_SCOPE_NOTE}`
}

/** 去掉注入文本里的「附件清单」段(其余段原样保留) */
export function stripAttachmentSection(content: string): string {
  // 与 summarizeInjection 同一套分段口径(`\n\n`);附件段内部不会出现空行
  // (buildAttachmentSection 用 oneLine 压过),所以按段过滤是安全的。
  const sections = content.split('\n\n').filter((s) => !s.trimStart().startsWith(ATTACHMENT_MARK))
  return sections.join('\n\n')
}

function parseMetaJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * 用 RecordAttachment.vision* 里的图片摘要补全历史中的附件段。
 *
 * 背景:多模态主模型首轮直接看图,由 save_image_content 把看到的内容写进附件缓存;
 * 但当时生成的注入段只有文件名。后续轮次从 DB 重放历史时,靠这里把摘要补回去,
 * 模型才「记得」图片内容(否则只知道有个附件,连是照片还是小票都不清楚)。
 *
 * 附件来源:
 *   - 当前轮 → 调用方从**代码上下文**传入(就是本轮请求的 attachments);
 *   - 历史轮 → ChatMessageAttachment 关联表。
 * 完全不解析注入文本里的 attachmentId(文本格式一变就会静默失效)。
 *
 * 特性:不写库、幂等;没有摘要的附件保持原样(措辞仍是「直接看图」);
 * 历史里没有任何附件段时直接返回,零开销。
 */
export async function enrichAttachmentSections(
  messages: { role: string; content: unknown }[],
  messageIds: string[],
  /** 当前轮的附件(来自代码上下文)。续写/确认路径没有新的用户消息,可不传 */
  current?: { messageId: string; attachments: { id: string; originalFilename: string }[] },
): Promise<void> {

  // 1) 定位含附件段的消息(index 是 messages 下标;messageId 直接存下来,避免后面再从别的数组按下标取)
  const targets: { index: number; sectionIdx: number; messageId: string }[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'user' || typeof msg.content !== 'string') continue
    if (!msg.content.includes(ATTACHMENT_MARK)) continue
    const sections = msg.content.split('\n\n')
    const sectionIdx = sections.findIndex((s) => s.trimStart().startsWith(ATTACHMENT_MARK))
    if (sectionIdx >= 0) targets.push({ index: i, sectionIdx, messageId: messageIds[i] || '' })
  }
  if (targets.length === 0) return

  // 2) 关联表:messageId → 附件(结构化来源)。当前轮用调用方传入的,不必查表
  const usedMessageIds = [
    ...new Set(
      targets
        .filter((t) => !current || t.messageId !== current.messageId)
        .map((t) => t.messageId)
        .filter(Boolean),
    ),
  ]
  const links = usedMessageIds.length > 0
    ? await prisma.chatMessageAttachment
        .findMany({
          where: { messageId: { in: usedMessageIds } },
          select: { messageId: true, attachment: { select: { id: true, originalFilename: true } } },
        })
        .catch(() => [])
    : []
  const byMessage = new Map<string, { id: string; originalFilename: string }[]>()
  for (const link of links) {
    const item = { id: link.attachment.id, originalFilename: link.attachment.originalFilename }
    const list = byMessage.get(link.messageId)
    if (list) list.push(item)
    else byMessage.set(link.messageId, [item])
  }

  // 3) 当前轮用代码上下文,历史轮用关联表;关联表也没有 ⇒ 跳过该消息(不再反解析文本)
  const resolved = targets
    .map((t) => {
      const isCurrent = !!current && t.messageId === current.messageId
      return {
        ...t,
        attachments: isCurrent ? current.attachments : (byMessage.get(t.messageId) ?? []),
      }
    })
    .filter((t) => t.attachments.length > 0)

  const ids = [...new Set(resolved.flatMap((r) => r.attachments.map((a) => a.id)))]
  if (ids.length === 0) return

  // 4) 一次查缓存(只取已生成摘要的)
  const rows = await prisma.recordAttachment
    .findMany({
      where: { id: { in: ids }, visionAt: { not: null } },
      select: { id: true, visionSummary: true, visionText: true, visionMeta: true },
    })
    .catch(() => [])

  const contexts = new Map<string, AttachmentTextContext>()
  for (const row of rows) {
    if (!row.visionSummary) continue
    contexts.set(row.id, {
      summary: row.visionSummary,
      text: row.visionText || '',
      meta: parseMetaJson(row.visionMeta),
    })
  }
  if (contexts.size === 0) return

  // 5) 只重建「该消息的附件确实有摘要」的段:新图(尚无摘要)保持原段,
  //    否则会把多模态首轮的「先调用 save_image_content」指引一起抹掉
  for (const target of resolved) {
    if (!target.attachments.some((a) => contexts.has(a.id))) continue
    const sections = (messages[target.index].content as string).split('\n\n')
    if (sections[target.sectionIdx] === undefined) continue
    sections[target.sectionIdx] = buildAttachmentSection(target.attachments, contexts, false)
    messages[target.index].content = sections.join('\n\n')
  }
}

/** 注入文本除前缀外是否还有实际内容 */
function hasContentBeyondPrefix(text: string): boolean {
  const body = text.startsWith(INJECT_PREFIX) ? text.slice(INJECT_PREFIX.length) : text
  return body.trim().length > 0
}

/**
 * 重试:接管「被替换的那条用户消息」的注入内容,并删掉它的注入消息。
 *
 * 为什么必须做:日期/记忆/技能都是**会话级差量**(已注入过就不再写),而重试走的是
 * 「新建一条用户消息」的路径 —— 新一轮只会拿到「附件清单」那一段,日期/记忆/技能
 * 则随旧消息一起被排除在历史链之外,模型这一轮就完全看不到它们了(表现为:重试后
 * AI 忘了用户偏好/长期记忆)。
 *
 * 为什么返回**文本**而不是把旧消息转挂过去:转挂会让「旧消息一条 + 新一轮一条」变成
 * **两个注入 chip**(首次发送时是拼成一条的)。这里把内容取出来交给调用方,由调用方
 * 作为 extraSections 交给新一轮的 persistInjectionIfChanged —— 它会与差量段拼成
 * **同一条**注入消息,于是重试与首次发送的形态一致。
 *
 * 附件段会被**剥掉**:它必须由新一轮重新生成 —— 图片的文字化摘要可能是在两次之间
 * 才生成出来的(`image-context.ts`),继承旧段会让新摘要永远进不了上下文。
 * 返回值已去掉注入前缀(前缀由新一轮统一加一次,避免重复)。
 */
async function readInjections(fromUserId: string): Promise<{ sections: string[]; ids: string[] }> {
  const injects = await prisma.chatMessage.findMany({
    where: { role: INJECT_ROLE, parentMessageId: fromUserId },
    select: { id: true, content: true },
  }).catch(() => [])

  const sections: string[] = []
  const ids: string[] = []
  for (const inj of injects) {
    ids.push(inj.id)
    const kept = stripAttachmentSection(inj.content)
    if (hasContentBeyondPrefix(kept)) sections.push(stripInjectPrefix(kept))
  }
  return { sections, ids }
}

/**
 * 读出指定用户消息上的注入内容（剥掉附件段、去掉注入前缀），**不删除**那条注入消息。
 *
 * 编辑重发用它：新消息与被编辑的那条是「同父兄弟」，注入必须带过来，否则新分支只剩
 * 新一轮生成的「附件清单」段，模型看不到日期/记忆/技能。但与重试不同 —— 编辑是「新增一个
 * 分支」，旧消息要留在 1/2 里可切换，所以只复制内容、不能把旧的注入搬走。
 */
export async function collectInjections(fromUserId: string): Promise<string[]> {
  return (await readInjections(fromUserId)).sections
}

export async function takeOverInjections(fromUserId: string): Promise<string[]> {
  const { sections, ids } = await readInjections(fromUserId)
  // 内容已取出(或只剩附件段)⇒ 旧消息一律删掉:该由新一轮统一写回
  for (const id of ids) await prisma.chatMessage.delete({ where: { id } }).catch(() => {})
  return sections
}

/** 去掉注入前缀(前缀在新一轮统一加一次) */
function stripInjectPrefix(text: string): string {
  return (text.startsWith(INJECT_PREFIX) ? text.slice(INJECT_PREFIX.length) : text).trim()
}

/**
 * 压成干净的多行文本:连续空行折叠为一个换行(避免摘要里的空行把注入段切成多块,
 * summarizeInjection 是按 `\n\n` 分段的),可选截断。
 */
function oneLine(text: string, limit?: number): string {
  const compact = text.trim().replace(/\n{2,}/g, '\n')
  if (!limit || compact.length <= limit) return compact
  return compact.slice(0, limit) + '…'
}

/**
 * 从注入文本反解出展示摘要(供 UI 显示「本轮注入了哪些记忆/技能」)。
 * 与 planInjection / buildAttachmentSection 的写入格式成对维护 —— 改动格式必须同步改这里并跑单测。
 */
export function summarizeInjection(content: string): InjectionSummary {
  const summary: InjectionSummary = { date: null, memories: [], skills: [], hasAttachments: false, raw: content }
  const body = content.startsWith(INJECT_PREFIX) ? content.slice(INJECT_PREFIX.length) : content

  for (const rawSection of body.split('\n\n')) {
    const section = rawSection.trim()
    if (!section) continue

    const dateMatch = /^今天是 (\d{4}-\d{2}-\d{2})。?$/.exec(section)
    if (dateMatch) {
      summary.date = dateMatch[1]
      continue
    }
    if (section.startsWith(ATTACHMENT_MARK)) {
      summary.hasAttachments = true
      continue
    }
    if (section.startsWith(MEMORY_HEADING)) {
      summary.memories.push(
        ...section.split('\n').slice(1).map((line) => line.replace(/^-\s*/, '').trim()).filter(Boolean),
      )
      continue
    }
    // 技能提示词以 markdown 标题开头,取第一个标题作为技能名
    const heading = /^#{1,3}\s+(.+)$/m.exec(section)?.[1]
    if (heading) summary.skills.push(heading.trim())
  }
  return summary
}

export interface InjectedState {
  /** 已注入的日期(YYYY-MM-DD),每天首次注入一次 */
  date: string | null
  /** 已注入的记忆 id(后续只追加差量,避免每轮重复占用 token) */
  memoryIds: string[]
  /** 已注入的技能名(同一会话内只注入一次) */
  skills: string[]
  /**
   * 当前账本(切账本或改账本名时重新注入)。
   * 账本信息以前插值在系统提示词里 —— 一变就让整段历史缓存失效,移到这里后只追加一条尾部消息。
   */
  bookId: string | null
  bookName: string | null
  /** 已注入的回复语言(改设置时重新注入) */
  language: string | null
  /** 已注入的工具清单指纹(用户改工具开关时重新注入;运行时开关不进这里,避免每轮变化) */
  toolsKey: string | null
}

export interface MemoryForInject {
  id: string
  memoryType: string
  content: string
}

export interface SkillForInject {
  name: string
  prompt: string
}

export interface InjectInput {
  /** 当前日期(YYYY-MM-DD) */
  today: string
  memories: MemoryForInject[]
  skills: SkillForInject[]
  /** 当前账本(首轮注入,之后切账本/改名才重新注入) */
  bookId: string
  bookName: string
  /** 回复语言(首轮注入,改设置才重新注入) */
  language: string
  /** 首轮注入用的完整工具清单(按分类,建立「能力地图」) */
  toolsText: string
  /** 当前可用工具名:与上次比较得出「已禁用/已恢复」差量 */
  toolNames: string[]
  /** 当前禁用工具总数(差量文案里给模型一个规模感) */
  disabledToolCount: number
  /**
   * 随本轮附带的临时上下文(如附件清单):不做去重、每轮原样带上,
   * 其目的在于「不再把它拼进不落库的请求文本」——那样下一轮重放时文本不同,缓存会在这条消息处失效。
   */
  extraSections?: string[]
}

export interface InjectPlan {
  text: string
  nextState: InjectedState
}

const EMPTY_STATE: InjectedState = {
  date: null, memoryIds: [], skills: [],
  bookId: null, bookName: null, language: null, toolsKey: null,
}

/** 解析会话上记录的注入指纹(损坏或缺失时按「什么都没注入过」处理) */
export function parseInjectedState(raw: string | null | undefined): InjectedState {
  if (!raw) return { ...EMPTY_STATE }
  try {
    const parsed = JSON.parse(raw) as Partial<InjectedState>
    return {
      date: typeof parsed.date === 'string' ? parsed.date : null,
      memoryIds: Array.isArray(parsed.memoryIds) ? parsed.memoryIds.filter((v): v is string => typeof v === 'string') : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter((v): v is string => typeof v === 'string') : [],
      // 老会话没有这些字段 ⇒ 下一轮会各补注入一次(相当于初始化),无需数据库迁移
      bookId: typeof parsed.bookId === 'string' ? parsed.bookId : null,
      bookName: typeof parsed.bookName === 'string' ? parsed.bookName : null,
      language: typeof parsed.language === 'string' ? parsed.language : null,
      toolsKey: typeof parsed.toolsKey === 'string' ? parsed.toolsKey : null,
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function serializeInjectedState(state: InjectedState): string {
  return JSON.stringify(state)
}

/**
 * 计算本轮要追加的注入文本。
 * 无差异时返回 null —— 此时**不写任何消息**,历史前缀保持逐字节不变(缓存命中)。
 */
export function planInjection(state: InjectedState, input: InjectInput): InjectPlan | null {
  const sections: string[] = []
  const nextState: InjectedState = {
    date: state.date,
    memoryIds: [...state.memoryIds],
    skills: [...state.skills],
    bookId: state.bookId,
    bookName: state.bookName,
    language: state.language,
    toolsKey: state.toolsKey,
  }

  // 1. 日期:跨天才注入
  if (state.date !== input.today) {
    sections.push(`今天是 ${input.today}。`)
    nextState.date = input.today
  }

  // 2. 记忆:只注入本会话还没给过的条目(差量)
  const knownMemories = new Set(state.memoryIds)
  const freshMemories = input.memories.filter((m) => !knownMemories.has(m.id))
  if (freshMemories.length > 0) {
    const lines = freshMemories.map((m) => `- [${MEMORY_TYPE_LABELS[m.memoryType] || '记忆'}] ${m.content}`)
    sections.push(`${MEMORY_HEADING}\n${lines.join('\n')}`)
    nextState.memoryIds = [...state.memoryIds, ...freshMemories.map((m) => m.id)]
  }

  // 3. 技能:同一会话内同名技能只注入一次(技能文本是静态的)
  const knownSkills = new Set(state.skills)
  const freshSkills = input.skills.filter((s) => !knownSkills.has(s.name))
  if (freshSkills.length > 0) {
    sections.push(freshSkills.map((s) => s.prompt).join('\n\n'))
    nextState.skills = [...state.skills, ...freshSkills.map((s) => s.name)]
  }

  // 4. 账本:切账本 / 改账本名才重新注入
  //    (以前插值在系统提示词里 —— 一变就让其后整段历史缓存失效)
  if (state.bookId !== input.bookId || state.bookName !== input.bookName) {
    sections.push(`当前操作账本：「${input.bookName}」(ID: ${input.bookId})。跨账本操作请用 switch_book。`)
    nextState.bookId = input.bookId
    nextState.bookName = input.bookName
  }

  // 5. 回复语言:改设置才重新注入
  if (state.language !== input.language) {
    sections.push(input.language === 'en' ? 'Reply in English.' : '使用中文回复。')
    nextState.language = input.language
  }

  // 6. 工具清单:首轮给一次完整清单,之后只注入差量。
  //    指纹只含用户设置层 —— 联网开关/多模态这类运行时状态走执行层拦截,
  //    否则开关一拨就每轮注入,反而把历史撑长。
  //    差量而非全量:否则历史里会堆多份互相矛盾的全量清单,模型可能拿旧的当现状。
  const nextToolsKey = [...input.toolNames].sort().join(',')
  if (state.toolsKey !== nextToolsKey && input.toolNames.length > 0) {
    if (state.toolsKey === null) {
      if (input.toolsText) sections.push(input.toolsText)
    } else {
      const prevTools = new Set(state.toolsKey.split(',').filter(Boolean))
      const nextTools = new Set(input.toolNames)
      const disabledNow = [...prevTools].filter((n) => !nextTools.has(n))
      const enabledNow = [...nextTools].filter((n) => !prevTools.has(n))
      if (disabledNow.length > 0 || enabledNow.length > 0) {
        const lines: string[] = []
        if (disabledNow.length > 0) lines.push(`- 已禁用：${disabledNow.join('、')}`)
        if (enabledNow.length > 0) lines.push(`- 已恢复：${enabledNow.join('、')}`)
        lines.push(
          input.disabledToolCount > 0
            ? `当前共有 ${input.disabledToolCount} 个工具不可用。`
            : '当前没有禁用的工具。',
        )
        sections.push(`工具可用性变更：\n${lines.join('\n')}`)
      }
    }
    nextState.toolsKey = nextToolsKey
  }

  // 7. 随本轮附带的上下文(如附件清单):不去重,放在最后(离本轮请求最近)
  for (const extra of input.extraSections ?? []) {
    if (extra) sections.push(extra)
  }

  if (sections.length === 0) return null
  return { text: `${INJECT_PREFIX}\n${sections.join('\n\n')}`, nextState }
}

/**
 * 落库本轮注入(无差异时不写任何东西)。
 * 返回本次写入的注入记录(含展示摘要),供调用方通过 SSE 让界面实时显示;无注入时为 null。
 */
export async function persistInjectionIfChanged(params: {
  sessionId: string
  accountBookId: string | null
  /** 注入绑定的用户消息 id(折叠时按它回填) */
  userMessageId: string
  /** 会话当前的注入指纹(ChatSession.injectedContext) */
  currentState: string | null | undefined
  input: InjectInput
}): Promise<ChatInjection | null> {
  const plan = planInjection(parseInjectedState(params.currentState), params.input)
  if (!plan) return null

  try {
    const created = await prisma.chatMessage.create({
      data: {
        sessionId: params.sessionId,
        accountBookId: params.accountBookId,
        role: INJECT_ROLE,
        content: plan.text,
        parentMessageId: params.userMessageId,
        tokenCount: estimateTokens(plan.text),
      },
    })
    await prisma.chatSession.update({
      where: { id: params.sessionId },
      data: { injectedContext: serializeInjectedState(plan.nextState) },
    })
    return {
      id: created.id,
      parentMessageId: params.userMessageId,
      createdAt: created.createdAt.toISOString(),
      summary: summarizeInjection(plan.text),
    }
  } catch (err) {
    // 库未迁移(缺注入相关列)等情况下降级为「不注入」,不能让整轮对话失败
    console.warn('[context-inject] 注入落库失败,本轮跳过注入:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * 把注入消息折叠进它所属的用户消息。
 * 两个装配路径必须都调用本函数、且规则一致,才能保证「同一轮请求重放后文本一致」。
 */
export function foldInjections(
  messages: { role: string; content: unknown }[],
  messageIds: string[],
  injects: { parentMessageId: string | null; content: string }[],
): void {
  if (injects.length === 0) return

  const byUserMessage = new Map<string, string[]>()
  for (const inject of injects) {
    if (!inject.parentMessageId || !inject.content) continue
    const list = byUserMessage.get(inject.parentMessageId)
    if (list) list.push(inject.content)
    else byUserMessage.set(inject.parentMessageId, [inject.content])
  }
  if (byUserMessage.size === 0) return

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'user' || typeof msg.content !== 'string') continue
    const texts = byUserMessage.get(messageIds[i] ?? '')
    if (!texts || texts.length === 0) continue
    msg.content = `${msg.content}\n\n${texts.join('\n\n')}`
  }
}
