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

/** 构造附件清单注入段(空数组返回空串,表示本轮不注入) */
export function buildAttachmentSection(attachments: { id: string; originalFilename: string }[]): string {
  if (attachments.length === 0) return ''
  const lines = attachments.map((a) => `attachmentId: ${a.id}\n文件名: ${a.originalFilename}`)
  return `${ATTACHMENT_MARK}\n${lines.join('\n')}`
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

const EMPTY_STATE: InjectedState = { date: null, memoryIds: [], skills: [] }

/** 解析会话上记录的注入指纹(损坏或缺失时按「什么都没注入过」处理) */
export function parseInjectedState(raw: string | null | undefined): InjectedState {
  if (!raw) return { ...EMPTY_STATE }
  try {
    const parsed = JSON.parse(raw) as Partial<InjectedState>
    return {
      date: typeof parsed.date === 'string' ? parsed.date : null,
      memoryIds: Array.isArray(parsed.memoryIds) ? parsed.memoryIds.filter((v): v is string => typeof v === 'string') : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter((v): v is string => typeof v === 'string') : [],
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

  // 4. 随本轮附带的上下文(如附件清单):不去重,放在最后(离本轮请求最近)
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
