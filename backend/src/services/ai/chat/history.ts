import {prisma} from '../../../app.js'
import {dedupeToolCalls} from '../tool-call-id.js'
import {assertIsMember} from '../security.js'
import {enrichAttachmentSections, foldInjections, INJECT_ROLE} from '../context-inject.js'
import {stripThinkTags} from '../context-compress.js'
import {applyPendingImageInjection} from './pending-image.js'

/** 查询本次请求引用的附件（只取后续读取/展示需要的字段） */
export async function loadChatAttachments(
  attachmentIds: string[] | undefined,
): Promise<{ id: string; url: string; originalFilename: string }[]> {
  if (!attachmentIds || attachmentIds.length === 0) return []
  const rows = await prisma.recordAttachment.findMany({
    where: { id: { in: attachmentIds } },
    select: { id: true, path: true, originalFilename: true },
  })
  return rows.map(a => ({ id: a.id, url: a.path, originalFilename: a.originalFilename }))
}

/**
 * 重试：删除被替换的助手消息及其所有后继（按 parentMessageId 逐层向下）。
 * 返回「被替换的那条用户消息」id —— 它的注入消息要继承给新消息。
 */
export async function deleteAssistantSubtree(replaceAssistantDbId: string): Promise<string | null> {
  const replaced = await prisma.chatMessage.findUnique({
    where: { id: replaceAssistantDbId },
    select: { parentMessageId: true },
  })
  const retriedUserId = replaced?.parentMessageId ?? null

  let idsToDelete = [replaceAssistantDbId]
  while (idsToDelete.length > 0) {
    await prisma.chatMessage.deleteMany({ where: { id: { in: idsToDelete } } })
    const children = await prisma.chatMessage.findMany({
      where: { parentMessageId: { in: idsToDelete } },
      select: { id: true },
    })
    idsToDelete = children.map((c) => c.id)
  }
  return retriedUserId
}

/** 从 parentMessageId 沿链回溯到根，得到纯文本历史（history 与 historyIds 严格一一对应） */
export function buildHistoryChain(
  allMessages: { id: string; role: string; content: string; parentMessageId: string | null }[],
  parentId: string | null,
): { history: { role: 'user' | 'assistant'; content: string }[]; historyIds: string[] } {
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  const historyIds: string[] = []
  if (!parentId) return { history, historyIds }

  let currentId: string | null = parentId
  while (currentId) {
    const msg = allMessages.find((m) => m.id === currentId)
    if (!msg) break
    if (msg.role === 'user' || msg.role === 'assistant') {
      history.unshift({ role: msg.role, content: msg.content })
      historyIds.unshift(msg.id)
    }
    currentId = msg.parentMessageId
  }
  return { history, historyIds }
}

export interface PendingToolMsg {
  message: { id: string; toolCalls: string | null; sessionId: string; accountBookId: string | null; parentMessageId: string | null; modelProvider: string | null; modelName: string | null }
  entry: any
  toolCalls: any[]
  accountBookId: string
}

/** 查找并校验待确认的工具消息（归属、账本成员、是否已被后续对话顶成历史分支） */
export async function findPendingToolMessage(toolCallId: string, userId: string): Promise<{ success: true; data: PendingToolMsg } | { success: false; status: number; message: string }> {
  const message = await prisma.chatMessage.findFirst({
    where: { toolCalls: { contains: toolCallId } },
    select: { id: true, toolCalls: true, sessionId: true, accountBookId: true, parentMessageId: true, createdAt: true, modelProvider: true, modelName: true },
  })
  if (!message) return { success: false, status: 404, message: '确认已过期或不存在' }

  let toolCalls: any[]
  try { toolCalls = dedupeToolCalls(JSON.parse(message.toolCalls || '[]')) } catch { return { success: false, status: 404, message: '确认已过期或不存在' } }
  const entry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
  if (!entry) return { success: false, status: 404, message: '确认已过期或不存在' }

  const accountBookId = message.accountBookId
  if (!accountBookId) return { success: false, status: 404, message: '会话不存在' }
  try { await assertIsMember(accountBookId, userId) } catch (e: any) {
    return { success: false, status: e.statusCode || 403, message: e.message }
  }

  // 之后已有新消息 → 这张卡片属于历史分支,确认它会让「上下文是线性重放」的链路错序
  // (buildChatMessages 按 sessionId 全量重放,不区分分支),所以直接判定失效
  const newerCount = await prisma.chatMessage.count({
    where: { sessionId: message.sessionId, createdAt: { gt: message.createdAt } },
  })
  if (newerCount > 0) {
    return { success: false, status: 409, message: '该操作已过期（之后已有新的对话），请重新发起' }
  }

  return { success: true, data: { message, entry, toolCalls, accountBookId } }
}

/** 从 DB 重建 AI SDK 消息数组（含注入折叠、附件摘要补全、待注入图片） */
export async function buildChatMessages(sessionId: string, pendingToolResults: { toolCallId: string; toolName: string; result: unknown }[]): Promise<{ messages: any[]; messageIds: string[] }> {
  const dbMessages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, reasoningContent: true, toolCalls: true, parentMessageId: true, modelProvider: true, modelName: true, tokenCount: true },
    take: 1000,
  })

  const pendingIds = new Set(pendingToolResults.map(p => p.toolCallId))
  /** 已插到所属 assistant 消息后面的 pending 结果（其余走兜底追加） */
  const placedPending = new Set<string>()
  const messages: any[] = []
  const messageIds: string[] = []
  // 注入消息(role='inject')不进消息数组,只在最后折叠回它所属的用户消息
  const injects: { parentMessageId: string | null; content: string }[] = []
  for (const msg of dbMessages) {
    if (msg.role === INJECT_ROLE) {
      injects.push({ parentMessageId: msg.parentMessageId, content: msg.content })
    } else if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content })
      messageIds.push(msg.id)
    } else if (msg.role === 'assistant') {
      // 去重:旧数据可能残留重复 tool_call_id(旧版 id 会撞号),重放时重复项会让上游拒绝整轮请求
      const tcList: any[] = dedupeToolCalls<any>(msg.toolCalls ? JSON.parse(msg.toolCalls) : [])
      const tcIds = new Set(tcList.map((tc: any) => tc.toolCallId))
      const contentParts: any[] = []
      if (msg.content) {
        const cleanText = stripThinkTags(msg.content)
        if (cleanText) contentParts.push({ type: 'text', text: cleanText })
      }
      // 回传推理模型的 reasoning_content（openai-compatible 用 reasoning part 还原为 reasoning_content）
      if (msg.reasoningContent) {
        const cleanReasoning = stripThinkTags(msg.reasoningContent)
        if (cleanReasoning) contentParts.push({ type: 'reasoning', text: cleanReasoning })
      }
      const completedResults: any[] = []
      for (const tc of tcList) {
        const isPendingConfirm = pendingIds.has(tc.toolCallId)
        const hasResult = tc.result != null && tc.status !== 'confirming' && tc.status !== 'suggesting'
        // 跳过无结果的工具调用（被中断的并发工具），避免 AI SDK MissingToolResultsError
        if (!isPendingConfirm && !hasResult) continue
        contentParts.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.args })
        if (!isPendingConfirm && hasResult) {
          completedResults.push(tc)
        }
      }
      messages.push({ role: 'assistant', content: contentParts })
      messageIds.push(msg.id)

      // 本次 decisions 的结果必须**紧跟它所属的 assistant 消息**，与已有结果合成同一条 tool 消息。
      // 若像以前那样统一追加到消息数组末尾，一旦该 assistant 消息不是最后一条（多轮确认、或同消息里
      // 已确认过另一张卡产生了续写消息），它的 tool 结果会被后续消息隔开，上游直接拒：
      //   An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'
      const pendingHere = pendingToolResults.filter(p => tcIds.has(p.toolCallId))
      const resultParts = [
        ...completedResults.map((tc: any) => ({
          type: 'tool-result',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: { type: 'json', value: tc.result },
        })),
        // 同样按 id 去重:客户端 decisions 若重复提交同一 toolCallId,重复项会让上游拒绝整轮请求
        ...dedupeToolCalls(pendingHere).map(p => ({
          type: 'tool-result',
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          output: { type: 'json', value: p.result },
        })),
      ]
      if (resultParts.length > 0) {
        messages.push({ role: 'tool', content: resultParts })
        messageIds.push(msg.id) // tool 消息复用 assistant 的 ID
      }
      for (const p of pendingHere) placedPending.add(p.toolCallId)
    }
  }

  // 兜底：找不到所属 assistant 消息的 pending 结果（理论不该发生）也要回传，否则同样会被上游拒
  const leftoverPending = pendingToolResults.filter(p => !placedPending.has(p.toolCallId))
  if (leftoverPending.length > 0) {
    messages.push({
      role: 'tool',
      content: dedupeToolCalls(leftoverPending).map(p => ({
        type: 'tool-result',
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: { type: 'json', value: p.result },
      })),
    })
    messageIds.push('') // pending tool result 无对应 DB 消息
  }

  // 折叠规则与主消息流程一致(见 context-inject.ts 顶部说明)
  foldInjections(messages, messageIds, injects)
  // 附件段补摘要(与主消息流程同一套规则:两条装配路径的文本必须一致)
  await enrichAttachmentSections(messages, messageIds)

  // view_image 请求「直接看图」时,把图作为 user message 注入一次
  await applyPendingImageInjection(sessionId, messages)

  return { messages, messageIds }
}

/** 解析落库的 usage(历史脏数据/解析失败时忽略,不影响消息本身) */
export function parseUsageJson(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}
