import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import fastifyStatic from '@fastify/static'
import scalar from '@scalar/fastify-api-reference'
import path from 'path'
import fs from 'fs'
import { prisma, rawPrisma } from './lib/prisma.js'

export { prisma, rawPrisma }

export async function buildApp() {
  const app = Fastify({
    logger: true,
  })

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  })

  // JWT
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'homibook-secret-key-change-in-production',
  })

  // Multipart for file uploads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(multipart as any, {
    // 512MB 上限：数据迁移导入的备份 zip 可能较大；CSV 等常规上传不受影响
    limits: { fileSize: 512 * 1024 * 1024 },
  })

  // Swagger OpenAPI 文档（自动从路由 schema 生成规范）
  // transform 回调：从 routeOptions.config.swaggerResponse 注入返回值文档
  // 因为 Fastify 会将 schema.response 用于 JSON 序列化，可能导致数据损坏
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Homibook API',
        description: '家庭记账本 API 文档',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:3002' }],
    },
    transform: ({ schema, url, route }) => {
      const swaggerResponse = (route as any)?.config?.swaggerResponse
      if (swaggerResponse && !schema.response) {
        schema.response = swaggerResponse
      }
      return { schema, url }
    },
  })

  // Scalar API 文档 UI — 自动检测 @fastify/swagger 生成的规范
  await app.register(scalar, {
    routePrefix: '/docs',
  })

  // Serve uploaded files statically
  const uploadsDir = path.join(process.cwd(), 'uploads')
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
  app.register(async (instance) => {
    instance.addHook('onRoute', (opts) => {
      opts.schema = { ...(opts.schema || {}), tags: ['文件服务'] }
    })
    instance.get('/uploads/:filename', async (req, reply) => {
      const filename = path.basename((req.params as any).filename)
      const filePath = path.join(uploadsDir, filename)
      if (!filePath.startsWith(uploadsDir)) return reply.status(403).send({ message: '非法路径' })
      if (!fs.existsSync(filePath)) return reply.status(404).send({ message: '文件不存在' })

      const ext = path.extname(filename).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.zip': 'application/zip',
      }
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      const buffer = await fs.promises.readFile(filePath)
      reply.header('Content-Type', contentType).send(buffer)
    })
  }, { prefix: '/api' })

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error)
    reply.status(error.statusCode || 500).send({
      statusCode: error.statusCode || 500,
      message: error.message,
    })
  })

  // 单容器部署：托管前端静态文件（public/ 目录存在时启用，开发环境不受影响）
  const publicDir = path.join(process.cwd(), 'public')
  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, prefix: '/' })
    // SPA 回退：非 API 路由返回 index.html，API 路由返回 JSON 404
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/docs') || req.url === '/health') {
        return reply.status(404).send({ message: 'Not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  return app
}

export type App = Awaited<ReturnType<typeof buildApp>>