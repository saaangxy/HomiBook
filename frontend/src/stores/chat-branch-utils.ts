import type { Message } from './chat'

export function buildActivePath(allMessages: Message[], branchSelections: Record<string, string>): Message[] {
  const path: Message[] = []
  if (allMessages.length === 0) return path

  const byId = new Map<string, Message>()
  for (const m of allMessages) {
    byId.set(m.id, m)
    if (m.dbId) byId.set(m.dbId, m)
  }

  const inPath = new Set<string>()

  let current = allMessages.find((m) => !m.parentMessageId || !byId.has(m.parentMessageId))
  while (current) {
    path.push(current)
    inPath.add(current.id)
    if (current.dbId) inPath.add(current.dbId)
    const currentId = current.dbId || current.id

    const children = allMessages.filter((m) => m.parentMessageId === currentId)
    if (children.length === 0) break

    const selectedId = branchSelections[currentId]
    current = selectedId
      ? children.find((c) => (c.dbId || c.id) === selectedId) || children[children.length - 1]
      : children[children.length - 1]
  }

  // 回退：parentMessageId 断链（如临时 ID 写入 DB）时，按 DB 顺序追加未渲染的孤儿消息
  for (const m of allMessages) {
    if (!inPath.has(m.id)) {
      path.push(m)
      inPath.add(m.id)
      if (m.dbId) inPath.add(m.dbId)
    }
  }

  return path
}

export function collectDescendantIds(allMessages: Message[], startDbId: string): Set<string> {
  const ids = new Set<string>()
  let frontier = [startDbId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      ids.add(id)
      for (const m of allMessages) {
        const childId = m.dbId || m.id
        if (m.parentMessageId === id && !ids.has(childId)) {
          next.push(childId)
        }
      }
    }
    frontier = next
  }
  return ids
}
