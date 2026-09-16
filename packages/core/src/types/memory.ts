/** AI 记忆领域类型(权威:与后端 save_memory 工具、GET /api/chat/memories 一致) */

export type MemoryType = 'habit' | 'preference' | 'rule' | 'fact';

/** 可写入的记忆类型全集(运行时校验用;后端 save_memory 工具枚举即此) */
export const MEMORY_TYPES = ['habit', 'preference', 'rule', 'fact'] as const;

/** 是否为合法记忆类型(可用于写入校验) */
export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value);
}

/**
 * 记忆类型中文标签。
 *
 * 键放宽为 string 是刻意的:历史数据里存在 `extracted`
 * (Prisma `UserMemory.memoryType` 的默认值),它不属于可写入类型,
 * 但会出现在接口响应里,需要可读标签而不是把原文直接显示给用户。
 */
export const MEMORY_TYPE_LABELS: Record<string, string> = {
  habit: '习惯',
  preference: '偏好',
  rule: '规则',
  fact: '事实',
  extracted: '自动提取',
};

export interface UserMemoryItem {
  id: string;
  userId: string;
  memoryType: string;
  content: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
}
