import { http } from './http';
import type { RecurringTransaction } from '@/types';
import type { RecurringTransaction as CoreRecurring } from '@homibook/core';

// 固定收支数据访问层 —— 真实后端 API

function toRecurring(r: CoreRecurring): RecurringTransaction {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    recurringType: r.recurringType ?? 'PERIODIC',
    amount: r.amount,
    accountId: r.accountId,
    accountName: r.account?.name ?? '',
    toAccountId: r.toAccountId ?? undefined,
    categoryCode: r.categoryCode ?? undefined,
    categoryName: undefined,
    payer: r.payer ?? undefined,
    remark: r.remark ?? undefined,
    cron: r.cron,
    active: r.active,
    nextGenerateAt: r.nextGenerateAt ?? undefined,
  };
}

export async function fetchRecurring(bookId: string): Promise<RecurringTransaction[]> {
  const res = await http.get<CoreRecurring[]>('/api/recurring/', { query: { bookId } });
  return (res ?? []).map(toRecurring);
}

export type RecurringCreatePayload = Omit<CoreRecurringCreate, 'accountBookId'>;

interface CoreRecurringCreate {
  accountBookId: string;
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amount: number;
  remark?: string | null;
  tags?: string[];
  accountId: string;
  toAccountId?: string;
  categoryCode?: string;
  payer?: string;
  cron: string;
}

export async function createRecurringApi(bookId: string, payload: RecurringCreatePayload): Promise<void> {
  await http.post('/api/recurring/', { ...payload, accountBookId: bookId });
}

export async function updateRecurringApi(id: string, payload: Partial<RecurringCreatePayload>): Promise<void> {
  await http.patch(`/api/recurring/${id}`, payload);
}

export async function deleteRecurringApi(id: string): Promise<void> {
  await http.delete(`/api/recurring/${id}`);
}

export async function toggleRecurringApi(id: string, active: boolean): Promise<void> {
  await http.patch(`/api/recurring/${id}/toggle`, { active });
}
