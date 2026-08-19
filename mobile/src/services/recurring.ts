import { mockRecurring } from '@/mock/data';
import type { RecurringTransaction } from '@/types';

// 固定收支数据访问层:当前返回 mock,后续替换为真实 API(recurringApi.*)时仅改这里
export function fetchRecurring(): Promise<RecurringTransaction[]> {
  return Promise.resolve(mockRecurring);
}