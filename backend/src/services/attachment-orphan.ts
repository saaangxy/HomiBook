/**
 * 附件孤儿清理的纯逻辑（无 DB / 文件系统副作用，便于单测）。
 *
 * 多对多后一个附件可能同时挂在多条流水上，也可能被 AI 聊天消息引用，
 * 因此「从某条流水上移除附件」不等于「可以删掉附件」。
 */

export interface AttachmentRef {
  id: string
  path: string
}

/**
 * 从候选附件中挑出可以安全删除的：既不挂在任何流水上，也不被聊天消息引用。
 *
 * @param candidates 本次可能变孤儿的附件（删除流水前取到的关联）
 * @param recordReferencedIds 仍然被流水引用的附件 id
 * @param chatReferencedIds 仍然被聊天消息引用的附件 id
 */
export function pickDeletableAttachments(
  candidates: AttachmentRef[],
  recordReferencedIds: Iterable<string>,
  chatReferencedIds: Iterable<string>,
): AttachmentRef[] {
  const byRecord = new Set(recordReferencedIds)
  const byChat = new Set(chatReferencedIds)
  return candidates.filter((a) => !byRecord.has(a.id) && !byChat.has(a.id))
}
