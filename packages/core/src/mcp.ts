// MCP 服务接入:三端共享的类型、常量与配置文案生成
// (后端返回 /api/mcp/info,web 与移动端设置页据此渲染)

export interface McpToolInfo {
  name: string
  displayName: string
  description: string
  category: string
  /** 是否写操作(需管理员开启后才对客户端可见) */
  write: boolean
}

export interface McpInfo {
  enabled: boolean
  writeEnabled: boolean
  /** 相对路径,如 /api/mcp */
  endpoint: string
  tools: McpToolInfo[]
}

/** 后端 MCP 入口(相对路径) */
export const MCP_ENDPOINT = '/api/mcp'

/** 配置示例里的 API Key 占位符 */
export const MCP_API_KEY_PLACEHOLDER = '<你的 API Key>'

/** 服务端系统配置键:配置键与接口返回字段不同名(mcpEnabled → enabled) */
export const MCP_CONFIG_KEYS = {
  enabled: 'mcpEnabled',
  writeEnabled: 'mcpWriteEnabled',
} as const

/** 拼接完整接入地址;origin 为空时退回相对路径(服务端渲染/未选服务器场景) */
export function resolveMcpUrl(origin: string, endpoint: string = MCP_ENDPOINT): string {
  const path = endpoint || MCP_ENDPOINT
  if (!origin) return path
  return `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/** 生成可直接粘贴到 MCP 客户端的 JSON 配置 */
export function buildMcpClientConfig(url: string, apiKey: string = MCP_API_KEY_PLACEHOLDER): string {
  return JSON.stringify(
    {
      mcpServers: {
        homibook: {
          type: 'streamable-http',
          url,
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    },
    null,
    2,
  )
}

/** Claude Code 命令行接入示例 */
export function buildMcpCliCommand(url: string, apiKey: string = MCP_API_KEY_PLACEHOLDER): string {
  return `claude mcp add --transport http homibook ${url} --header "Authorization: Bearer ${apiKey}"`
}

/** 按业务分类分组(保持后端返回顺序) */
export function groupMcpTools<T extends { category: string }>(tools: T[]): Array<{ category: string; tools: T[] }> {
  const groups: Array<{ category: string; tools: T[] }> = []
  for (const tool of tools) {
    const group = groups.find((g) => g.category === tool.category)
    if (group) group.tools.push(tool)
    else groups.push({ category: tool.category, tools: [tool] })
  }
  return groups
}

/** 按只读 / 写操作拆分工具清单 */
export function splitMcpTools(tools: McpToolInfo[]): { read: McpToolInfo[]; write: McpToolInfo[] } {
  return {
    read: tools.filter((t) => !t.write),
    write: tools.filter((t) => t.write),
  }
}
