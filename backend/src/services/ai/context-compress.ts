/**
 * 三级上下文压缩
 * Tier 1: 完整保留（短对话）
 * Tier 2: 旧消息工具结果精简
 * Tier 3: 最旧消息 LLM 摘要
 */

import {generateText} from 'ai'
import type {LanguageModelV3} from '@ai-sdk/provider'
import {estimateMessagesTokens, estimateTokens, estimateToolsTokens} from './token-estimate.js'

/** 计算历史消息的 token 预算 */
export function computeHistoryBudget(
  contextWindow: number | null | undefined,
  maxTokens: number,
  systemPrompt: string,
  tools: Record<string, any>,
): number {
  const window = contextWindow ?? 32768
  const safetyMargin = 500
  const summaryReserve = 300 // 为注入的摘要预留
  const systemPromptTokens = estimateTokens(systemPrompt)
  const toolsTokens = estimateToolsTokens(tools)
  const budget = window - maxTokens - systemPromptTokens - toolsTokens - safetyMargin - summaryReserve
  return  Math.max(budget, 1024) // 至少保留 1024 token 给历史
}

export interface CompressContextParams {
  messages: any[]
  messageIds: string[]              // 与 messages 对齐的 DB 消息 ID
  historyBudget: number
  systemPrompt: string
  sessionSummary: string | null
  summaryUpToMessageId: string | null
  model: LanguageModelV3
}

export interface CompressContextResult {
  messages: any[]
  systemPrompt: string
  newSummary: string | null
  newSummaryUpToMessageId: string | null
}

export async function compressContext(params: CompressContextParams): Promise<CompressContextResult> {
  const { messages, messageIds, historyBudget, systemPrompt, sessionSummary, summaryUpToMessageId, model } = params

  // 注入已有摘要
  let currentSummary = sessionSummary
  let currentSummaryUpToId = summaryUpToMessageId
  let promptWithSummary = currentSummary
    ? systemPrompt + `\n\n## 之前对话摘要\n${currentSummary}`
    : systemPrompt

  const totalTokens = estimateMessagesTokens(messages)

  // ---- Tier 1: 完整保留 ----
  if (totalTokens <= historyBudget) {
    return { messages, systemPrompt: promptWithSummary, newSummary: currentSummary, newSummaryUpToMessageId: currentSummaryUpToId }
  }

  // ---- Tier 2: 旧消息工具结果精简 ----
  const simplified = simplifyOldToolResults(messages, historyBudget)

  const simplifiedTokens = estimateMessagesTokens(simplified)
  if (simplifiedTokens <= historyBudget) {
    return { messages: simplified, systemPrompt: promptWithSummary, newSummary: currentSummary, newSummaryUpToMessageId: currentSummaryUpToId }
  }

  // ---- Tier 3: 最旧消息 LLM 摘要 ----
  const { keptMessages, keptIds, removedMessages, removedIds } = cutForSummary(simplified, messageIds, historyBudget)

  // 确定需要摘要的新消息（排除已被旧摘要覆盖的）
  const summaryStartIndex = findSummaryStartIndex(removedIds, summaryUpToMessageId)
  const messagesToSummarize = removedMessages.slice(summaryStartIndex)
  // 找最后一个非空 ID（跳过 pending tool result 的空占位）
  let lastSummarizedId = currentSummaryUpToId
  for (let i = removedIds.length - 1; i >= 0; i--) {
    if (removedIds[i]) { lastSummarizedId = removedIds[i]; break }
  }

  if (messagesToSummarize.length === 0) {
    // 没有新消息需要摘要（可能已被旧摘要覆盖），直接返回裁剪后的消息
    return { messages: keptMessages, systemPrompt: promptWithSummary, newSummary: currentSummary, newSummaryUpToMessageId: lastSummarizedId }
  }

  // 生成增量摘要
  const newSummary = await generateSummary(model, currentSummary, messagesToSummarize).catch((err) => {
    return null
  })

  if (newSummary) {
    currentSummary = newSummary
    currentSummaryUpToId = lastSummarizedId
    promptWithSummary = systemPrompt + `\n\n## 之前对话摘要\n${newSummary}`
  } else {
    // 摘要失败时仅丢弃消息，不注入摘要
  }

  const keptTokens = estimateMessagesTokens(keptMessages)
  return { messages: keptMessages, systemPrompt: promptWithSummary, newSummary: currentSummary, newSummaryUpToMessageId: currentSummaryUpToId }
}

// ---- Tier 2: 工具结果精简 ----

/** 近期窗口 = 末尾 50% 预算的消息，窗口内的工具结果不精简 */
function simplifyOldToolResults(messages: any[], budget: number): any[] {
  // 找到近期窗口的起始索引
  let recentTokens = 0
  let recentStart = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateMessagesTokens([messages[i]])
    if (recentTokens + t > budget * 0.5) break
    recentTokens += t
    recentStart = i
  }

  // 找到最后一条 user 消息：当前轮次的工具结果不精简（导入流程需要 preview_import 的完整数据）
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  const safeStart = lastUserIdx >= 0 ? Math.min(recentStart, lastUserIdx + 1) : recentStart

  return messages.map((msg, i) => {
    if (i >= safeStart) return msg // 近期窗口或当前轮次内不精简
    return simplifyMessageToolResults(msg)
  })
}

/** 精简单条消息中的工具结果 */
function simplifyMessageToolResults(msg: any): any {
  if (msg.role !== 'tool' || !Array.isArray(msg.content)) return msg

  return {
    ...msg,
    content: msg.content.map((part: any) => {
      if (part.type !== 'tool-result') return part
      return {
        ...part,
        output: { type: 'json', value: simplifyToolResult(part.output?.value ?? part.output) },
      }
    }),
  }
}

/** 工具结果精简为简短描述（保留 success 字段，避免 LLM 误判工具失败） */
function simplifyToolResult(output: any): any {
  if (output == null) return null

  // 保留原始 success 状态，让 LLM 知道工具是否成功
  const success = typeof output === 'object' && !Array.isArray(output) ? output?.success : undefined
  const base: Record<string, unknown> = {}
  if (success !== undefined) base.success = success

  if (Array.isArray(output)) {
    return { ...base, summary: `已精简：数组 ${output.length} 项` }
  }

  if (typeof output === 'object') {
    const keys = Object.keys(output).slice(0, 5)
    return { ...base, summary: `已精简：原字段 ${keys.join(', ')}` }
  }

  const str = String(output)
  if (str.length <= 150) return output
  return { ...base, summary: str.slice(0, 150) + '...' }
}

// ---- Tier 3: LLM 摘要裁剪 ----

/** 找到安全裁剪点：保留的首条须为 user 或 assistant（纯文本无 tool-call） */
function cutForSummary(messages: any[], messageIds: string[], budget: number): {
  keptMessages: any[]
  keptIds: string[]
  removedMessages: any[]
  removedIds: string[]
} {
  // 从末尾往前累加，找到保留的起始索引
  let accumulated = 0
  let cutIndex = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateMessagesTokens([messages[i]])
    if (accumulated + t > budget) {
      cutIndex = i + 1
      break
    }
    accumulated += t
  }

  // 至少保留最后 1 条
  if (cutIndex >= messages.length) cutIndex = messages.length - 1

  // 向前调整到安全边界：cutIndex 处的消息须为 user 或 assistant 纯文本
  cutIndex = findSafeCutPoint(messages, cutIndex)

  return {
    keptMessages: messages.slice(cutIndex),
    keptIds: messageIds.slice(cutIndex),
    removedMessages: messages.slice(0, cutIndex),
    removedIds: messageIds.slice(0, cutIndex),
  }
}

/** 找到安全裁剪点：保留的首条须为 user 或 assistant 纯文本（无 tool-call） */
function findSafeCutPoint(messages: any[], minCut: number): number {
  for (let i = minCut; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'user') return i
    if (msg.role === 'assistant' && !hasToolCall(msg)) return i
  }
  // 极端情况：找不到安全点，保留全部（不裁剪），避免消息全丢
  return 0
}

/** 检查 assistant 消息是否包含 tool-call */
function hasToolCall(msg: any): boolean {
  if (!Array.isArray(msg.content)) return false
  return msg.content.some((part: any) => part.type === 'tool-call')
}

// ---- 摘要生成 ----

/** 移除 <think>...</think> 推理块（含未闭合的情况） */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim()
}

/**
 * 找到需要摘要的起始索引（排除已被旧摘要覆盖的消息）
 * 如果 summaryUpToMessageId 不在 removedIds 中，说明旧摘要覆盖了更早的消息，全部需要摘要
 */
function findSummaryStartIndex(removedIds: string[], summaryUpToMessageId: string | null): number {
  if (!summaryUpToMessageId) return 0
  const idx = removedIds.indexOf(summaryUpToMessageId)
  if (idx === -1) return 0 // 不在范围内，全部需要摘要
  return idx + 1 // 该 ID 及之前的已被摘要覆盖
}

/** 调用 LLM 生成增量摘要 */
async function generateSummary(model: LanguageModelV3, existingSummary: string | null, messages: any[]): Promise<string> {
  const messagesText = messages.map((m: any) => {
    const role = m.role
    const text = typeof m.content === 'string'
      ? stripThinkTags(m.content)
      : Array.isArray(m.content)
        ? m.content.map((p: any) => {
            if (p.type === 'text') return stripThinkTags(p.text)
            if (p.type === 'tool-call') return `[调用工具 ${p.toolName}]`
            if (p.type === 'tool-result') return `[工具结果已精简]`
            return ''
          }).join(' ')
        : ''
    return `${role}: ${text}`
  }).join('\n')

  const system = '你是对话摘要助手。将对话压缩为简洁摘要（200字内），保留用户意图、已执行操作、关键金额/分类/账户信息。只输出摘要文本，不要加额外说明。'
  const prompt = existingSummary
    ? `已有摘要：\n${existingSummary}\n\n新增对话内容：\n${messagesText}\n\n请输出更新后的完整摘要：`
    : `请总结以下对话内容（200字以内）：\n\n${messagesText}`

  const result = await generateText({
    model,
    system,
    prompt,
    maxOutputTokens: 800,
    temperature: 0.3,
  })

  return stripThinkTags(result.text)
}
