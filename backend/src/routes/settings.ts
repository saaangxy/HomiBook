import type {FastifyInstance} from 'fastify'
import {prisma} from '../app.js'
import {authenticate, requireAdmin} from '../middleware/auth.js'
import {updateConfigSchema, createDictionarySchema, updateDictionarySchema} from '../schemas/settings.js'
import path from 'path'
import fs from 'fs'
import {z} from 'zod'
import {zSchema} from '../lib/schema-helpers.js'

export async function settingsRoutes(app: FastifyInstance) {
    // 公开端点 — 无需认证，独立作用域避免被下方 hook 影响
    app.get('/public', {
        schema: {
            description: '获取公开配置（注册开关、默认主题）',
            tags: ['设置']
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'object',
                    description: '公开配置',
                    properties: {
                        registrationOpen: {type: 'boolean', description: '是否开放注册'},
                        defaultTheme: {type: 'string', description: '默认主题'}
                    }
                }
            }
        }
    }, async () => {
        const configs = await prisma.systemConfig.findMany({
            where: {key: {in: ['registrationOpen', 'defaultTheme']}},
        })
        const result: Record<string, unknown> = {registrationOpen: true}
        for (const c of configs) {
            try {
                result[c.key] = JSON.parse(c.value)
            } catch {
                result[c.key] = c.value
            }
        }
        return result
    })

    // 登录用户可访问 — 独立子作用域
    app.register(async (child) => {
        child.addHook('onRequest', authenticate)

        // 字典 — 只读（所有登录用户可读）
        child.get('/dictionary/:group', {
            schema: {
                description: '获取字典数据',
                tags: ['设置'],
                params: zSchema(z.object({group: z.string()}))
            },
            config: {
                swaggerResponse: {
                    200: {
                        type: 'array',
                        description: '字典项列表',
                        items: {
                            type: 'object',
                            properties: {
                                id: {type: 'string', description: '字典项ID'},
                                group: {type: 'string', description: '分组'},
                                code: {type: 'string', description: '编码'},
                                label: {type: 'string', description: '名称'},
                                order: {type: 'number', description: '排序'},
                                createdAt: {type: 'string', description: '创建时间'},
                                updatedAt: {type: 'string', description: '更新时间'}
                            }
                        }
                    }
                }
            }
        }, async (req, reply) => {
            const {group} = req.params as { group: string }
            const items = await prisma.dictionary.findMany({
                where: {group},
                orderBy: {order: 'asc'},
            })
            return items
        })

        // 管理员 — 独立子作用域
        child.register(async (adminChild) => {
            adminChild.addHook('onRequest', requireAdmin)

            // 获取所有配置
            adminChild.get('/config', {
                schema: {
                    description: '获取所有系统配置',
                    tags: ['设置']
                },
                config: {
                    swaggerResponse: {
                        200: {
                            type: 'object',
                            description: '系统配置键值对',
                        },
                    },
                },
            }, async () => {
                const configs = await prisma.systemConfig.findMany()
                const result: Record<string, unknown> = {}
                for (const c of configs) {
                    try {
                        result[c.key] = JSON.parse(c.value)
                    } catch {
                        result[c.key] = c.value
                    }
                }
                return result
            })

            // 更新配置
            adminChild.put('/config', {
                schema: {
                    description: '更新系统配置',
                    tags: ['设置'],
                    body: zSchema(updateConfigSchema)
                }
            }, async (req, reply) => {
                const parsed = updateConfigSchema.safeParse(req.body)
                if (!parsed.success) {
                    return reply.status(400).send({message: parsed.error.issues[0].message})
                }

                for (const [key, value] of Object.entries(parsed.data)) {
                    if (value !== undefined) {
                        await prisma.systemConfig.upsert({
                            where: {key},
                            create: {key, value: JSON.stringify(value)},
                            update: {value: JSON.stringify(value)},
                        })
                    }
                }
                return {success: true}
            })

            // 添加字典项
            adminChild.post('/dictionary', {
                schema: {
                    description: '创建字典项',
                    tags: ['设置'],
                    body: zSchema(createDictionarySchema)
                }
            }, async (req, reply) => {
                const parsed = createDictionarySchema.safeParse(req.body)
                if (!parsed.success) {
                    return reply.status(400).send({message: parsed.error.issues[0].message})
                }
                const {group, code, label, order} = parsed.data

                try {
                    const item = await prisma.dictionary.create({
                        data: {group, code, label, order},
                    })
                    return item
                } catch (e: any) {
                    if (e.code === 'P2002') {
                        return reply.status(409).send({message: '该编码已存在'})
                    }
                    throw e
                }
            })

            // 更新字典项
            adminChild.patch('/dictionary/:id', {
                schema: {
                    description: '更新字典项',
                    tags: ['设置'],
                    body: zSchema(updateDictionarySchema),
                    params: zSchema(z.object({id: z.string()}))
                }
            }, async (req, reply) => {
                const {id} = req.params as { id: string }
                const parsed = updateDictionarySchema.safeParse(req.body)
                if (!parsed.success) {
                    return reply.status(400).send({message: parsed.error.issues[0].message})
                }

                const existing = await prisma.dictionary.findUnique({where: {id}})
                if (!existing) {
                    return reply.status(404).send({message: '字典项不存在'})
                }

                return prisma.dictionary.update({where: {id}, data: parsed.data})
            })

            // 删除字典项
            adminChild.delete('/dictionary/:id', {
                schema: {
                    description: '删除字典项',
                    tags: ['设置'],
                    params: zSchema(z.object({id: z.string()}))
                }
            }, async (req, reply) => {
                const {id} = req.params as { id: string }

                const existing = await prisma.dictionary.findUnique({where: {id}})
                if (!existing) {
                    return reply.status(404).send({message: '字典项不存在'})
                }

                await prisma.dictionary.delete({where: {id}})
                return {success: true}
            })

            // 查询孤儿附件（recordId 为 null 的数据库记录 + uploads 目录下无数据库记录的孤儿文件）
            adminChild.get('/attachments/orphans', {
                schema: {
                    description: '获取孤立附件列表（未关联流水的数据库记录 + 无数据库记录的孤儿文件）',
                    tags: ['设置']
                },
                config: {
                    swaggerResponse: {
                        200: {
                            type: 'array',
                            description: '孤立附件列表',
                            items: {
                                type: 'object',
                                properties: {
                                    id: {type: 'string', description: '附件ID（孤儿文件用文件名）'},
                                    path: {type: 'string', description: '文件路径'},
                                    originalFilename: {type: 'string', description: '原始文件名'},
                                    createdAt: {type: 'string', description: '创建时间'},
                                    fileExists: {type: 'boolean', description: '文件是否存在'}
                                }
                            }
                        }
                    }
                }
            }, async () => {
                const uploadsDir = path.join(process.cwd(), 'uploads')

                // 1. 数据库孤儿：recordId 为 null 的 RecordAttachment 记录
                const dbOrphans = await prisma.recordAttachment.findMany({
                    where: {recordId: null},
                    select: {id: true, path: true, originalFilename: true, createdAt: true},
                    orderBy: {createdAt: 'asc'},
                })

                // 2. 文件系统孤儿：uploads 目录下没有数据库记录的物理文件
                const allPaths = await prisma.recordAttachment.findMany({select: {path: true}})
                const dbFilenames = new Set(allPaths.map((a) => path.basename(a.path)))
                const orphanFiles: Array<{id: string; path: string; originalFilename: string; createdAt: Date; fileExists: boolean}> = []
                if (fs.existsSync(uploadsDir)) {
                    for (const filename of fs.readdirSync(uploadsDir)) {
                        if (!dbFilenames.has(filename)) {
                            const stat = fs.statSync(path.join(uploadsDir, filename))
                            if (stat.isFile()) {
                                orphanFiles.push({
                                    id: filename,
                                    path: `/api/uploads/${filename}`,
                                    originalFilename: filename,
                                    createdAt: stat.mtime,
                                    fileExists: true,
                                })
                            }
                        }
                    }
                }

                return [
                    ...dbOrphans.map((a) => ({
                        ...a,
                        fileExists: fs.existsSync(path.join(uploadsDir, path.basename(a.path))),
                    })),
                    ...orphanFiles,
                ]
            })

            // 清理孤儿附件（删除未关联流水的数据库记录 + 无数据库记录的孤儿文件）
            adminChild.post('/attachments/clean-orphans', {
                schema: {
                    description: '清理孤立附件（数据库记录 + 孤儿文件）',
                    tags: ['设置']
                }
            }, async () => {
                const uploadsDir = path.join(process.cwd(), 'uploads')
                let deletedFiles = 0
                let deletedRecords = 0

                // 1. 清理数据库孤儿（recordId 为 null）的记录和文件
                const dbOrphans = await prisma.recordAttachment.findMany({
                    where: {recordId: null},
                    select: {id: true, path: true},
                })
                for (const att of dbOrphans) {
                    const filePath = path.join(uploadsDir, path.basename(att.path))
                    if (fs.existsSync(filePath)) {
                        try {
                            fs.unlinkSync(filePath)
                            deletedFiles++
                        } catch {
                            // 单个文件删除失败不中断整体清理
                        }
                    }
                }
                if (dbOrphans.length > 0) {
                    const result = await prisma.recordAttachment.deleteMany({
                        where: {recordId: null},
                    })
                    deletedRecords = result.count
                }

                // 2. 清理文件系统孤儿（uploads 目录下没有数据库记录的文件）
                const allPaths = await prisma.recordAttachment.findMany({select: {path: true}})
                const dbFilenames = new Set(allPaths.map((a) => path.basename(a.path)))
                if (fs.existsSync(uploadsDir)) {
                    for (const filename of fs.readdirSync(uploadsDir)) {
                        if (!dbFilenames.has(filename)) {
                            try {
                                fs.unlinkSync(path.join(uploadsDir, filename))
                                deletedFiles++
                            } catch {
                                // 单个文件删除失败不中断整体清理
                            }
                        }
                    }
                }

                return {deletedFiles, deletedRecords}
            })
        })
    })
}
