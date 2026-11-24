import { api } from './http'

export interface McpToolInfo {
  name: string
  displayName: string
  description: string
  category: string
  write: boolean
}

export interface McpInfo {
  enabled: boolean
  writeEnabled: boolean
  endpoint: string
  tools: McpToolInfo[]
}

export const mcpApi = {
  info: () => api.get<McpInfo>('/api/mcp/info'),
}
