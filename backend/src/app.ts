import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

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

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error)
    reply.status(error.statusCode || 500).send({
      statusCode: error.statusCode || 500,
      message: error.message,
    })
  })

  return app
}

export type App = Awaited<ReturnType<typeof buildApp>>