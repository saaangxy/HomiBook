import type { FastifyInstance, FastifyReply } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import { createMcpServer } from '../services/mcp/server.js'
import { getMcpCatalog } from '../services/mcp/registry.js'

/** 读取 MCP 相关系统配置（缺省为关闭） */
async function readMcpConfig() {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ['mcpEnabled', 'mcpWriteEnabled'] } },
  })
  const values = new Map(rows.map((r) => [r.key, r.value]))

  const readBool = (key: string) => {
    const raw = values.get(key)
    if (raw === undefined) return false
    try {
      return JSON.parse(raw) === true
    } catch {
      return raw === 'true'
    }
  }

  return { enabled: readBool('mcpEnabled'), writeEnabled: readBool('mcpWriteEnabled') }
}

/** 无状态 Streamable HTTP：GET / DELETE 不支持（没有会话可管理） */
function methodNotAllowed(reply: FastifyReply) {
  return reply.status(405).send({
    jsonrpc: '2.0',
    error: { code: -32000, message: '仅支持 POST 请求' },
    id: null,
  })
}

export async function mcpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 设置页使用：返回开关状态、连通地址与工具目录
  app.get('/info', {
    schema: {
      description: '获取 MCP 服务状态与可用工具目录',
      tags: ['MCP'],
    },
    config: {
      swaggerResponse: {
        200: {
          type: 'object',
          description: 'MCP 服务信息',
          properties: {
            enabled: { type: 'boolean', description: '是否启用 MCP 服务' },
            writeEnabled: { type: 'boolean', description: '是否允许写操作' },
            endpoint: { type: 'string', description: 'MCP 接入地址' },
            tools: {
              type: 'array',
              description: '工具目录',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: '工具名' },
                  displayName: { type: 'string', description: '中文名称' },
                  description: { type: 'string', description: '说明' },
                  category: { type: 'string', description: '业务分类' },
                  write: { type: 'boolean', description: '是否写操作' },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const { enabled, writeEnabled } = await readMcpConfig()
    return {
      enabled,
      writeEnabled,
      endpoint: '/api/mcp',
      tools: getMcpCatalog(),
    }
  })

  // MCP Streamable HTTP 入口（无状态：每个请求独立创建 server + transport）
  app.post('/', async (req, reply) => {
    const { enabled, writeEnabled } = await readMcpConfig()
    if (!enabled) {
      return reply.status(503).send({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'MCP 服务未启用，请先在设置中开启' },
        id: null,
      })
    }

    const userId = (req as unknown as { user: { id: string } }).user.id

    reply.hijack()

    const server = createMcpServer({ userId, writeEnabled })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    reply.raw.on('close', () => {
      transport.close().catch(() => {})
      server.close().catch(() => {})
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(req.raw, reply.raw, req.body)
    } catch (err) {
      req.log.error(err)
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' })
        reply.raw.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'MCP 服务内部错误' },
          id: null,
        }))
      }
    }
  })

  app.get('/', async (_req, reply) => methodNotAllowed(reply))
  app.delete('/', async (_req, reply) => methodNotAllowed(reply))
}
