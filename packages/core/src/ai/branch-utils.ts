/** AI 对话分支管理 —— 纯 TS,三端共享。 */
import type { Message } from '../types/index.js';

export function buildActivePath(allMessages: Message[], branchSelections: Record<string, string>): Message[] {
  const path: Message[] = [];
  if (allMessages.length === 0) return path;

  const byId = new Map<string, Message>();
  for (const m of allMessages) {
    byId.set(m.id, m);
    if (m.dbId) byId.set(m.dbId, m);
  }

  const inPath = new Set<string>();

  // 遍历全部根消息,逐条 walk 到底按序拼接(单根场景行为不变;多根场景——
  // 如本地 greeting 消息后紧跟无父的临时消息——每条根的子链都能完整渲染)
  for (const root of allMessages) {
    if (inPath.has(root.id)) continue;
    if (root.parentMessageId && byId.has(root.parentMessageId)) continue;

    let current: Message | undefined = root;
    while (current) {
      if (inPath.has(current.id)) break;
      path.push(current);
      inPath.add(current.id);
      if (current.dbId) inPath.add(current.dbId);
      const currentId: string = current.dbId || current.id;

      const children: Message[] = allMessages.filter((m) => m.parentMessageId === currentId);
      if (children.length === 0) break;

      const selectedId: string | undefined = branchSelections[currentId];
      current = selectedId
        ? children.find((c) => (c.dbId || c.id) === selectedId) || children[children.length - 1]
        : children[children.length - 1];
    }
  }

  return path;
}

export function collectDescendantIds(allMessages: Message[], startDbId: string): Set<string> {
  const ids = new Set<string>();
  let frontier = [startDbId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      ids.add(id);
      for (const m of allMessages) {
        const childId = m.dbId || m.id;
        if (m.parentMessageId === id && !ids.has(childId)) {
          next.push(childId);
        }
      }
    }
    frontier = next;
  }
  return ids;
}

export interface RetryRemovalPlan {
  /** 重试要重发的文本（原用户消息的文本块拼接） */
  text: string;
  /** 被清除的原用户消息 id */
  userMessageId: string;
  /** 删除该助手消息及其全部后代、以及原用户消息之后的全量消息 */
  keptMessages: Message[];
}

/**
 * 重试前的清理计划：定位要重试的助手消息，给出需要重发的文本与清理后的消息列表。
 *
 * 只做计算、不改状态 —— web / mobile 的 store 各自决定如何落地（都是写回 allMessages）。
 * 返回 null 表示不可重试：索引为 0、前一条不是用户消息、或原文为空。
 */
export function planRetryRemoval(
  allMessages: Message[],
  branchSelections: Record<string, string>,
  assistantMsgId: string,
): RetryRemovalPlan | null {
  const messages = buildActivePath(allMessages, branchSelections);
  const idx = messages.findIndex((m) => m.id === assistantMsgId);
  if (idx <= 0) return null;

  const prevUser = messages[idx - 1];
  if (prevUser.role !== 'user') return null;

  const text = prevUser.blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.content)
    .join('\n');
  if (!text) return null;

  const assistantId = messages[idx].dbId || messages[idx].id;
  const userId = prevUser.dbId || prevUser.id;
  const descendants = collectDescendantIds(allMessages, assistantId);
  const keptMessages = allMessages.filter((m) => {
    const id = m.dbId || m.id;
    return !descendants.has(id) && id !== assistantId && id !== userId;
  });

  return { text, userMessageId: userId, keptMessages };
}
