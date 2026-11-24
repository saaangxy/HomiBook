import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { prisma } from '../../app.js'
import { APP_VERSION } from '../../version.js'
import { assertIsMember } from '../ai/security.js'
import { logToolCall } from '../ai/audit.js'
import { runTool } from '../ai/runtime/run-tool.js'
import { listMcpTools, type McpToolMeta } from './registry.js'

/** 默认账本：优先自己创建的账本，其次加入的账本 */
export async function resolveBookId(userId: string, explicit?: string): Promise<string> {
  if (explicit) {
    await assertIsMember(explicit, userId)
    return explicit
  }

  const owned = await prisma.accountBook.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (owned) return owned.id

  const member = await prisma.accountBookMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: { accountBookId: true },
  })
  if (member) return member.accountBookId

  throw new Error('当前用户还没有可用的账本，请先在 HomiBook 中创建账本')
}

/** 列出可访问账本（含自己创建与受邀加入的） */
async function listBooks(userId: string) {
  const books = await prisma.accountBook.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return {
    total: books.length,
    books: books.map((b) => ({
      id: b.id,
      name: b.name,
      role: b.ownerId === userId ? 'owner' : 'member',
      memberCount: b._count.members,
      createdAt: b.createdAt,
    })),
  }
}

function toText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload === undefined) return ''
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function asInputSchema(meta: McpToolMeta) {
  return meta.inputSchema as {
    type: 'object'
    properties?: Record<string, object>
    required?: string[]
  }
}

/** 单次请求的 MCP Server（无状态传输，每个 HTTP 请求独立创建） */
export function createMcpServer(opts: { userId: string; writeEnabled: boolean }) {
  const server = new Server(
    { name: 'homibook', version: APP_VERSION },
    { capabilities: { tools: {} } },
  )

  const tools = listMcpTools(opts.writeEnabled)
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.displayName,
      description: t.description,
      inputSchema: asInputSchema(t),
      annotations: {
        readOnlyHint: !t.write,
        destructiveHint: t.write,
      },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const meta = toolMap.get(req.params.name)
    if (!meta) {
      return {
        content: [{ type: 'text', text: `未找到工具: ${req.params.name}` }],
        isError: true,
      }
    }

    const args = (req.params.arguments ?? {}) as Record<string, unknown>

    try {
      // MCP 层自带的账本列表工具
      if (meta.name === 'list_books') {
        const data = await listBooks(opts.userId)
        return { content: [{ type: 'text', text: toText(data) }] }
      }

      const tool = meta.tool
      if (!tool) throw new Error(`工具未注册: ${meta.name}`)

      const bookId = meta.needsBook
        ? await resolveBookId(opts.userId, typeof args.bookId === 'string' ? args.bookId : undefined)
        : ''

      // MCP 调用本身即用户的显式操作，跳过交互式确认卡直接执行
      const outcome = await runTool({
        tool,
        args,
        ctx: { userId: opts.userId, accountBookId: bookId, confirmed: true },
        deps: {
          assertMember: bookId
            ? (id, userId) => assertIsMember(id, userId)
            : async () => {},
          logToolCall: (event) =>
            logToolCall({
              userId: opts.userId,
              action: 'mcp_tool_call',
              toolName: event.toolName,
              input: event.input,
              output: event.output,
              errorMessage: event.errorMessage,
              durationMs: event.durationMs,
              status: event.status,
            }),
        },
        autoConfirm: true,
      })

      if (outcome.kind === 'paused') {
        const payload = outcome.result?.data ?? outcome.payload
        return { content: [{ type: 'text', text: toText(payload) }] }
      }

      if (!outcome.result.success) {
        return {
          content: [{ type: 'text', text: outcome.result.error ?? '工具执行失败' }],
          isError: true,
        }
      }

      return { content: [{ type: 'text', text: toText(outcome.result.data) }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      }
    }
  })

  return server
}
