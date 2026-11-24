import { api } from './http'
import type { McpInfo } from '@homibook/core'

export type { McpInfo, McpToolInfo } from '@homibook/core'

export const mcpApi = {
  info: () => api.get<McpInfo>('/api/mcp/info'),
}
