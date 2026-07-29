import { prisma } from '../../app.js'

// 记忆类型默认重要程度
const DEFAULT_IMPORTANCE: Record<string, number> = {
  habit: 0.6,
  preference: 0.7,
  rule: 0.8,
  fact: 0.5,
}

/**
 * 简单中文分词：按标点和空格分割，2 字符滑动窗口
 * 从 chat.ts 移入，保持逻辑一致
 */
export function extractKeywords(text: string): string[] {
  const split = text.split(/[\s，。！？,\.!\?;；：:]+/).filter(Boolean)
  const keywords: string[] = []
  for (const seg of split) {
    if (seg.length >= 2) keywords.push(seg)
    if (seg.length > 4) {
      for (let i = 0; i <= seg.length - 2; i++) {
        keywords.push(seg.slice(i, i + 2))
      }
    }
  }
  return [...new Set(keywords)].slice(0, 20)
}

/**
 * 加载系统提示词用记忆：top-N 重要 + 关键词匹配，去重合并
 * query 为空时仅返回 top-N 重要记忆
 */
export async function loadMemoriesForPrompt(userId: string, query: string, limit = 8) {
  // 1. 查询 top-N 重要记忆
  const topMemories = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: [{ importance: 'desc' }, { lastAccessedAt: 'desc' }],
    take: limit,
    select: { id: true, content: true, memoryType: true, importance: true },
  })

  let result = topMemories

  // 2. 若 query 非空，额外查询关键词匹配的记忆
  if (query) {
    const terms = extractKeywords(query)
    if (terms.length > 0) {
      const orConditions = terms.flatMap(t => [
        { keywords: { contains: t } },
        { content: { contains: t } },
      ])
      const matched = await prisma.userMemory.findMany({
        where: { userId, OR: orConditions },
        orderBy: [{ importance: 'desc' }, { lastAccessedAt: 'desc' }],
        take: limit * 2,
        select: { id: true, content: true, memoryType: true, importance: true },
      })
      // 合并去重
      const seen = new Set(topMemories.map(m => m.id))
      const merged = [...topMemories, ...matched.filter(m => !seen.has(m.id))]
        .sort((a, b) => b.importance - a.importance)
        .slice(0, limit)
      result = merged
    }
  }

  // 3. 更新访问记录（修复原 searchMemories 未 await 的 bug）
  if (result.length > 0) {
    await prisma.userMemory.updateMany({
      where: { id: { in: result.map(m => m.id) } },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    }).catch(() => {})
  }

  return result
}

/**
 * 按关键词搜索记忆（供 search_memory 工具调用）
 */
export async function searchMemoriesByKeyword(userId: string, query: string, limit: number) {
  const terms = extractKeywords(query)
  if (terms.length === 0) {
    // 无关键词时返回 top 记忆
    return prisma.userMemory.findMany({
      where: { userId },
      orderBy: [{ importance: 'desc' }, { lastAccessedAt: 'desc' }],
      take: limit,
      select: { id: true, content: true, memoryType: true, importance: true },
    })
  }

  const orConditions = terms.flatMap(t => [
    { keywords: { contains: t } },
    { content: { contains: t } },
  ])
  const memories = await prisma.userMemory.findMany({
    where: { userId, OR: orConditions },
    orderBy: [{ importance: 'desc' }, { lastAccessedAt: 'desc' }],
    take: limit,
    select: { id: true, content: true, memoryType: true, importance: true },
  })

  // 更新访问记录
  if (memories.length > 0) {
    await prisma.userMemory.updateMany({
      where: { id: { in: memories.map(m => m.id) } },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    }).catch(() => {})
  }

  return memories
}

/**
 * 保存记忆（带简单去重：同 userId + 相同 content 不重复创建）
 */
export async function saveMemory(userId: string, content: string, memoryType: string, importance?: number) {
  const effectiveImportance = importance ?? DEFAULT_IMPORTANCE[memoryType] ?? 0.5
  const keywords = extractKeywords(content).join(',')

  // 查询同 userId + 相同 content 的记忆
  const existing = await prisma.userMemory.findFirst({
    where: { userId, content },
  })
  if (existing) {
    // 已存在，若新重要程度更高则更新
    if (effectiveImportance > existing.importance) {
      const updated = await prisma.userMemory.update({
        where: { id: existing.id },
        data: { importance: effectiveImportance },
      })
      return { created: false, memory: updated }
    }
    return { created: false, memory: existing }
  }

  const memory = await prisma.userMemory.create({
    data: { userId, content, keywords, memoryType, importance: effectiveImportance },
  })
  return { created: true, memory }
}

/**
 * 列出全部记忆（UI 用）
 */
export async function listMemories(userId: string) {
  return prisma.userMemory.findMany({
    where: { userId },
    orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, content: true, memoryType: true, importance: true, createdAt: true, updatedAt: true, accessCount: true },
  })
}

/**
 * 删除记忆
 */
export async function deleteMemory(userId: string, id: string) {
  const result = await prisma.userMemory.deleteMany({ where: { id, userId } })
  return result.count > 0
}

/**
 * 更新记忆（content / importance）
 */
export async function updateMemory(userId: string, id: string, data: { content?: string; importance?: number }) {
  const updateData: { content?: string; keywords?: string; importance?: number } = {}
  if (data.content !== undefined) {
    updateData.content = data.content
    updateData.keywords = extractKeywords(data.content).join(',')
  }
  if (data.importance !== undefined) {
    updateData.importance = data.importance
  }
  return prisma.userMemory.updateMany({ where: { id, userId }, data: updateData })
}
