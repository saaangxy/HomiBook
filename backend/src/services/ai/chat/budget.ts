import {prisma} from '../../../app.js'
import {compressContext} from '../context-compress.js'

/** 工具清单的体积（算上下文预算用）：只要 description + 参数 schema，不需要 execute */
export function toolSchemaMap(tools: { name: string; description: string; parameters: unknown }[]): Record<string, any> {
  const map: Record<string, any> = {}
  for (const tool of tools) {
    map[tool.name] = { description: tool.description, inputSchema: tool.parameters }
  }
  return map
}

/**
 * 压缩上下文并把新摘要写回会话。
 * /send 与确认续流两条装配路径共用，避免摘要口径与落库时机各写一遍。
 */
export async function compressAndPersist(opts: {
  sessionId: string
  messages: any[]
  messageIds: string[]
  historyBudget: number
  systemPrompt: string
  model: any
}) {
  const session = await prisma.chatSession.findUnique({
    where: { id: opts.sessionId },
    select: { summary: true, summaryUpToMessageId: true },
  })
  const compressed = await compressContext({
    messages: opts.messages,
    messageIds: opts.messageIds,
    historyBudget: opts.historyBudget,
    systemPrompt: opts.systemPrompt,
    sessionSummary: session?.summary ?? null,
    summaryUpToMessageId: session?.summaryUpToMessageId ?? null,
    model: opts.model,
  })

  // 持久化摘要更新
  if (compressed.newSummary !== null && compressed.newSummary !== session?.summary) {
    await prisma.chatSession.update({
      where: { id: opts.sessionId },
      data: { summary: compressed.newSummary, summaryUpToMessageId: compressed.newSummaryUpToMessageId },
    }).catch(() => {})
  }
  return compressed
}
