import type {FastifyInstance} from 'fastify'
import {generateText} from 'ai'
import {prisma} from '../app.js'
import {authenticate} from '../middleware/auth.js'
import {createModel, DEFAULT_BASE_URLS, type ProviderType} from '../services/ai/providers.js'
import {loadUserProviderConfig} from '../services/ai/security.js'
import {
  confirmActionSchema,
  createSessionSchema,
  sendMessageSchema,
  updateSessionSchema
} from '../schemas/chat.js'
import {INJECT_ROLE, summarizeInjection} from '../services/ai/context-inject.js'
import {zSchema} from '../lib/schema-helpers.js'
import {z} from 'zod'
import type {ChatInjection} from '@homibook/core'
import {loadAIConfig} from '../services/ai/chat/session.js'
import {parseUsageJson} from '../services/ai/chat/history.js'
import {createSSEWriter} from '../services/ai/chat/sse.js'
import {runConversationTurn} from '../services/ai/chat/turn.js'
import {runConfirmationTurn} from '../services/ai/chat/confirm.js'

declare module 'fastify' {
  interface FastifyContextConfig {
    swaggerResponse?: Record<number, unknown>
  }
}

interface RouteDoc {
  summary: string
  description?: string
  swaggerResponse?: Record<number, unknown>
  bodySchema?: any
  paramsSchema?: any
  querystringSchema?: any
}

const SID_PARAMS = z.object({ id: z.string().describe('会话ID') })
const PID_PARAMS = z.object({ id: z.string().describe('配置ID') })
const MSG_PARAMS = z.object({ id: z.string().describe('会话ID') })
const PROVIDER_PARAMS = z.object({ provider: z.string().describe('供应商类型') })

const ROUTE_DOC: Record<string, RouteDoc> = {
  'POST /send': {summary: '发送消息', description: '发送消息给AI，SSE流式返回响应', bodySchema: sendMessageSchema},
  'GET /sessions': {
    summary: '获取会话列表',
    swaggerResponse: {
      200: {
        type: 'object',
        description: '会话列表',
        properties: {
          sessions: {
            type: 'array',
            description: '会话列表',
            items: {
              type: 'object',
              properties: {
                id: {type: 'string', description: '会话ID'},
                title: {type: 'string', description: '标题'},
                modelProvider: {type: 'string', description: '模型供应商'},
                modelName: {type: 'string', description: '模型名称'},
                updatedAt: {type: 'string', description: '更新时间'}
              }
            }
          }
        }
      }
    }
  },
  'POST /sessions': {
    summary: '创建新会话',
    description: '创建新的AI对话会话',
    bodySchema: createSessionSchema,
    swaggerResponse: {
      200: {
        type: 'object',
        description: '新会话',
        properties: {session: {type: 'object', description: '会话详情'}}
      }
    }
  },
  'PATCH /sessions/:id': {
    summary: '更新会话',
    description: '修改会话标题、状态或模型配置',
    bodySchema: updateSessionSchema,
    paramsSchema: SID_PARAMS
  },
  'POST /sessions/:id/generate-title': {
    summary: '生成会话标题',
    description: 'AI自动为会话生成标题',
    paramsSchema: SID_PARAMS
  },
  'DELETE /sessions/:id': {summary: '删除会话', paramsSchema: SID_PARAMS},
  'GET /sessions/:id/messages': {
    summary: '获取会话消息',
    description: '获取指定会话的所有消息记录',
    paramsSchema: MSG_PARAMS,
    swaggerResponse: {
      200: {
        type: 'object',
        description: '会话消息列表',
        properties: {
          messages: {
            type: 'array',
            description: '消息列表',
            items: {
              type: 'object',
              properties: {
                id: {type: 'string', description: '消息ID'},
                role: {type: 'string', description: '角色'},
                content: {type: 'string', description: '内容'},
                toolCalls: {type: 'string', description: '工具调用JSON'},
                modelProvider: {type: 'string', description: '模型供应商'},
                modelName: {type: 'string', description: '模型名称'},
                parentMessageId: {type: 'string', description: '父消息ID'},
                createdAt: {type: 'string', description: '创建时间'}
              }
            }
          }
        }
      }
    }
  },
  'POST /confirm': {
    summary: '确认工具操作',
    description: '用户确认或拒绝AI工具调用（覆盖全部工具：普通确认/导入/建议选项/切换账本，支持批量 decisions）',
    bodySchema: confirmActionSchema
  },
}

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('onRoute', (opts) => {
    const key = `${opts.method} ${opts.url}`.replace(/\/api\/chat\//, '/')
    const doc = ROUTE_DOC[key]
    opts.schema = {
      ...(opts.schema || {}),
      tags: ['AI 助手'],
      summary: doc?.summary || opts.schema?.summary,
      ...(doc?.description ? { description: doc.description } : {}),
      ...(doc?.bodySchema ? { body: zSchema(doc.bodySchema) } : {}),
      ...(doc?.paramsSchema ? { params: zSchema(doc.paramsSchema) } : {}),
      ...(doc?.querystringSchema ? { querystring: zSchema(doc.querystringSchema) } : {}),
    }
    // 返回值文档存入 config.swaggerResponse，由 swagger transform 注入
    // 避免 Fastify 将 schema.response 用于序列化导致数据损坏
    if (doc?.swaggerResponse) {
      (opts.config as any) = { ...(opts.config || {}), swaggerResponse: doc.swaggerResponse }
    }
  })
  app.addHook('onRequest', authenticate)

  // SSE 流式发送消息
  app.post('/send', async (req, reply) => {
    const parsed = sendMessageSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const emit = createSSEWriter(reply)
    try {
      const result = await runConversationTurn({ userId, input: parsed.data, emit })
      if (!result.ok) return reply.status(result.status).send({ message: result.message })
    } finally {
      // 只有真的开始流式（emit 写过响应头）才收尾；校验失败的 JSON 响应交给 Fastify
      if (reply.raw.headersSent) reply.raw.end()
    }
  })

  // 会话列表（支持按账本筛选）
  app.get('/sessions', async (req) => {
    const userId = (req as any).user.id as string
    const { accountBookId } = req.query as { accountBookId?: string }

    const where: Record<string, unknown> = { userId, status: 'active' }
    if (accountBookId) where.accountBookId = accountBookId

    const sessions = await prisma.chatSession.findMany({
      where,
      select: { id: true, title: true, accountBookId: true, modelProvider: true, modelName: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    return { sessions }
  })

  // 创建会话
  app.post('/sessions', async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const { title, modelProvider, modelName } = parsed.data

    const session = await prisma.chatSession.create({
      data: { userId, title: title || '', modelProvider, modelName },
    })
    return { session }
  })

  // 更新会话
  app.patch('/sessions/:id', async (req, reply) => {
    const parsed = updateSessionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== userId) return reply.status(404).send({ message: '会话不存在' })

    await prisma.chatSession.update({ where: { id }, data: parsed.data })
    return { success: true }
  })

  // 自动生成会话标题
  app.post('/sessions/:id/generate-title', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== userId) return reply.status(404).send({ message: '会话不存在' })

    // 获取前几轮对话作为上下文
    const messages = await prisma.chatMessage.findMany({
      // 注入消息是系统上下文,不作为生成标题的素材
      where: { sessionId: id, role: { not: INJECT_ROLE } },
      orderBy: { createdAt: 'asc' },
      take: 6,
      select: { role: true, content: true, toolCalls: true },
    })

    if (messages.length === 0) return { title: session.title }

    const prefs = await loadAIConfig(userId)
    const simpleConfig = await loadUserProviderConfig(userId, prefs.simpleProviderConfigId)
    const provider = simpleConfig?.provider || ''
    const model = prefs.simpleModel || ''
    if (!provider || !model) return { title: session.title }

    const apiKey = simpleConfig?.apiKey || ''
    const baseURL = simpleConfig?.baseURL || DEFAULT_BASE_URLS[provider as ProviderType] || ''

    const conversationText = messages.map(m => {
      const content = (m.content || '').trim()
      const label = m.role === 'user' ? '用户' : '助手'
      // 纯图片/附件消息 content 为空，标注为图片消息让 LLM 理解上下文
      let text = content || '[图片消息]'
      // 助手消息补充工具调用名（content 只含纯文本，工具名能反映操作意图）
      if (m.role === 'assistant' && m.toolCalls) {
        try {
          const calls = JSON.parse(m.toolCalls) as { toolName?: string }[]
          const toolNames = calls.map(c => c.toolName).filter(Boolean)
          if (toolNames.length > 0) {
            text = `[工具: ${toolNames.join(', ')}] ${text}`
          }
        } catch { /* ignore */ }
      }
      return `${label}: ${text}`
    }).join('\n').slice(0, 800)

    try {
      const modelInstance = createModel(provider as ProviderType, model, { apiKey, baseURL })
      const result = await generateText({
        model: modelInstance,
        system: '你是一个标题生成助手。根据对话内容生成一个简短的标题（20个字以内），只返回标题文本，不要加引号或额外说明。',
        prompt: `请为以下对话生成一个简短的标题（20个字以内）：\n\n${conversationText}`,
        maxOutputTokens: 500,
        temperature: 0.3,
      })

      // 剥离推理模型的 <think>...</think> 思考块（含未闭合的截断情况）
      const title = result.text
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<think>[\s\S]*$/g, '')
        .trim()
        .slice(0, 30)
      if (title) {
        await prisma.chatSession.update({ where: { id }, data: { title } })
        return { title }
      }
    } catch (e){
      console.log(e)
      // 标题生成失败，保持原标题
    }

    return { title: session.title }
  })

  // 删除会话
  app.delete('/sessions/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== userId) return reply.status(404).send({ message: '会话不存在' })

    await prisma.chatSession.delete({ where: { id } })
    return { success: true }
  })

  /** 解析落库的 usage(历史脏数据/解析失败时忽略,不影响消息本身) */
  const parseUsageJson = (raw: string | null): Record<string, unknown> | undefined => {
    if (!raw) return undefined
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return undefined
    }
  }

  // 获取会话消息
  app.get('/sessions/:id/messages', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== userId) return reply.status(404).send({ message: '会话不存在' })

    const messages = await prisma.chatMessage.findMany({
      // 注入消息(role='inject')是给模型看的上下文,不返回给界面
      where: { sessionId: id, role: { not: INJECT_ROLE } },
      select: {
        id: true, role: true, content: true, reasoningContent: true, toolCalls: true, modelProvider: true, modelName: true, parentMessageId: true, createdAt: true,
        usageJson: true,
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: { attachment: { select: { id: true, path: true, originalFilename: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    // 上下文注入:按 parentMessageId 挂到对应的用户消息上(界面在用户消息下方展示「本轮注入了什么」)
    const injections = await prisma.chatMessage.findMany({
      where: { sessionId: id, role: INJECT_ROLE },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, parentMessageId: true, createdAt: true },
    })
    const injectionsByUserMessage = new Map<string, ChatInjection[]>()
    for (const inj of injections) {
      if (!inj.parentMessageId) continue
      const item: ChatInjection = {
        id: inj.id,
        parentMessageId: inj.parentMessageId,
        createdAt: inj.createdAt.toISOString(),
        summary: summarizeInjection(inj.content),
      }
      const list = injectionsByUserMessage.get(inj.parentMessageId)
      if (list) list.push(item)
      else injectionsByUserMessage.set(inj.parentMessageId, [item])
    }

    // 附件关联展平为 { id, url, originalFilename } 列表供前端回显
    return {
      messages: messages.map(({ attachments, usageJson, ...m }) => {
        const usage = parseUsageJson(usageJson)
        const messageInjections = injectionsByUserMessage.get(m.id)
        return {
          ...m,
          ...(usage ? { usage } : {}),
          ...(messageInjections ? { injections: messageInjections } : {}),
          ...(attachments.length > 0 ? {
            attachments: attachments.map(a => ({ id: a.attachment.id, url: a.attachment.path, originalFilename: a.attachment.originalFilename })),
          } : {}),
        }
      }),
    }
  })

  // 确认操作 → 始终批量处理（decisions 数组，覆盖全部工具类型：普通确认/导入/建议选项/切换账本）
  app.post('/confirm', async (req, reply) => {
    const parsed = confirmActionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const emit = createSSEWriter(reply)
    try {
      const result = await runConfirmationTurn({
        userId,
        decisions: parsed.data.decisions,
        enableWebSearch: parsed.data.enableWebSearch,
        emit,
      })
      if (!result.ok) return reply.status(result.status).send({ message: result.message })
    } finally {
      if (reply.raw.headersSent) reply.raw.end()
    }
  })
}
