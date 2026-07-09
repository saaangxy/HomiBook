import type { Message } from './chat'

export function buildActivePath(allMessages: Message[], branchSelections: Record<string, string>): Message[] {
  const path: Message[] = []
  if (allMessages.length === 0) return path

  const byId = new Map<string, Message>()
  for (const m of allMessages) {
    byId.set(m.id, m)
    if (m.dbId) byId.set(m.dbId, m)
  }

  let current = allMessages.find((m) => !m.parentMessageId || !byId.has(m.parentMessageId))
  while (current) {
    path.push(current)
    const currentId = current.dbId || current.id

    const children = allMessages.filter((m) => m.parentMessageId === currentId)
    if (children.length === 0) break

    const selectedId = branchSelections[currentId]
    current = selectedId
      ? children.find((c) => (c.dbId || c.id) === selectedId) || children[children.length - 1]
      : children[children.length - 1]
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
