import type { ToolDef } from '../ai/tools/types.js'
import { ALL_TOOLS } from '../ai/tools/index.js'

/**
 * MCP 对外暴露的工具目录。
 *
 * 复用 AI 助手的工具实现，但不直接照搬全部能力：
 * - 依赖前端确认卡 / 附件 / 会话状态的工具（导入、选图、切换账本、建议选项）不暴露；
 * - 联网搜索类工具不暴露（外网访问与费用由 AI 助手侧单独控制）；
 * - 写操作单独归类，由系统配置 mcpWriteEnabled 控制是否下发。
 */

export interface McpToolMeta {
  name: string
  displayName: string
  description: string
  category: string
  /** 会修改数据（创建/更新/删除/调账等） */
  write: boolean
  /** 执行前需要解析账本上下文 */
  needsBook: boolean
  inputSchema: Record<string, unknown>
  /** list_books 由 MCP 层自行实现，没有对应 ToolDef */
  tool?: ToolDef
}

/** 只读类工具：按业务分类分组 */
const READ_TOOL_GROUPS: Array<{ category: string; names: string[] }> = [
  {
    category: '查询',
    names: [
      'query_records',
      'query_accounts',
      'query_budgets',
      'query_categories',
      'get_stats',
      'query_balance_history',
      'query_members',
    ],
  },
  {
    category: '固定收支',
    names: ['query_recurring', 'query_repayment_plan', 'loan_preview'],
  },
  {
    category: '流水',
    names: ['detect_duplicates'],
  },
  {
    category: '记忆',
    names: ['search_memory', 'list_memories'],
  },
]

/** 写操作工具 */
const WRITE_TOOL_GROUPS: Array<{ category: string; names: string[] }> = [
  {
    category: '流水',
    names: [
      'create_record',
      'update_record',
      'delete_record',
      'batch_create_records',
      'batch_update_records',
      'batch_delete_records',
      'clone_record',
      'offset_records',
    ],
  },
  {
    category: '预算',
    names: ['set_budget', 'delete_budget', 'batch_create_budgets', 'copy_budgets'],
  },
  {
    category: '账户',
    names: ['create_account', 'update_account', 'delete_account', 'adjust_balance'],
  },
  {
    category: '固定收支',
    names: ['create_recurring', 'update_recurring', 'delete_recurring', 'toggle_recurring'],
  },
  {
    category: '账本',
    names: ['create_book'],
  },
  {
    category: '记忆',
    names: ['save_memory', 'delete_memory'],
  },
]

/** 不依赖账本上下文：账本创建与用户级记忆 */
const BOOKLESS_TOOLS = new Set([
  'create_book',
  'search_memory',
  'list_memories',
  'save_memory',
  'delete_memory',
])

const TOOL_MAP = new Map(ALL_TOOLS.map((t) => [t.name, t]))

/** 给账本级工具补一个可选的 bookId 入参 */
function withBookParam(parameters: Record<string, unknown>): Record<string, unknown> {
  const props = (parameters.properties as Record<string, unknown> | undefined) ?? {}
  return {
    ...parameters,
    properties: {
      ...props,
      bookId: {
        type: 'string',
        description: '账本 ID（可先调用 list_books 获取）；不传时使用默认账本',
      },
    },
  }
}

function buildMeta(name: string, category: string, write: boolean): McpToolMeta {
  const tool = TOOL_MAP.get(name)
  if (!tool) throw new Error(`MCP 工具未注册: ${name}`)
  const needsBook = !BOOKLESS_TOOLS.has(name)
  return {
    name,
    displayName: tool.displayName,
    description: tool.description,
    category,
    write,
    needsBook,
    inputSchema: needsBook ? withBookParam(tool.parameters) : tool.parameters,
    tool,
  }
}

const listBooksMeta: McpToolMeta = {
  name: 'list_books',
  displayName: '账本列表',
  description: '列出当前用户可访问的所有账本（ID、名称、角色、成员数）。其它工具不传 bookId 时使用默认账本。',
  category: '账本',
  write: false,
  needsBook: false,
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

const READ_TOOLS: McpToolMeta[] = READ_TOOL_GROUPS.flatMap((g) =>
  g.names.map((name) => buildMeta(name, g.category, false)),
)

const WRITE_TOOLS: McpToolMeta[] = WRITE_TOOL_GROUPS.flatMap((g) =>
  g.names.map((name) => buildMeta(name, g.category, true)),
)

export const MCP_READ_TOOLS: McpToolMeta[] = [listBooksMeta, ...READ_TOOLS]
export const MCP_WRITE_TOOLS: McpToolMeta[] = WRITE_TOOLS
export const MCP_ALL_TOOLS: McpToolMeta[] = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS]

/** 按开关返回可下发的工具 */
export function listMcpTools(writeEnabled: boolean): McpToolMeta[] {
  return writeEnabled ? MCP_ALL_TOOLS : MCP_READ_TOOLS
}

/** 设置页展示用的完整目录（含未开启的写操作） */
export function getMcpCatalog() {
  return MCP_ALL_TOOLS.map((t) => ({
    name: t.name,
    displayName: t.displayName,
    description: t.description,
    category: t.category,
    write: t.write,
  }))
}
