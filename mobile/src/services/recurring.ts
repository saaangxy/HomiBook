import { http } from './http';
import type { LoanInterestMethod, LoanPreview, RecurringTransaction, RepaymentPlan } from '@/types';
import type { RecurringTransaction as CoreRecurring } from '@homibook/core';

// 固定收支数据访问层 —— 真实后端 API(签名对齐 frontend/src/api/recurring.ts)

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
    toAccountName: r.toAccount?.name ?? undefined,
    categoryCode: r.categoryCode ?? undefined,
    categoryName: r.categoryCode ?? undefined,
    payer: r.payer ?? undefined,
    remark: r.remark ?? undefined,
    tags: r.tags ?? [],
    cron: r.cron,
    active: r.active,
    nextGenerateAt: r.nextGenerateAt ?? undefined,
    loanTotalAmount: r.loanTotalAmount,
    loanRemainingAmount: r.loanRemainingAmount,
    loanInterestRate: r.loanInterestRate,
    loanInterestMethod: r.loanInterestMethod,
    loanStartDate: r.loanStartDate,
    loanTermMonths: r.loanTermMonths,
  };
}

export async function fetchRecurring(bookId: string): Promise<RecurringTransaction[]> {
  const res = await http.get<CoreRecurring[]>('/api/recurring/', { query: { bookId } });
  return (res ?? []).map(toRecurring);
}

export interface RecurringCreatePayload {
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
  recurringType?: 'PERIODIC' | 'LOAN';
  // 贷款字段(仅创建时提交)
  loanTotalAmount?: number;
  loanInterestRate?: number;
  loanInterestMethod?: LoanInterestMethod;
  /** ISO 日期 */
  loanStartDate?: string;
  loanTermMonths?: number;
  generateAll?: boolean;
}

export async function createRecurringApi(bookId: string, payload: RecurringCreatePayload): Promise<void> {
  await http.post('/api/recurring/', { ...payload, accountBookId: bookId });
}

export async function updateRecurringApi(id: string, payload: Partial<RecurringCreatePayload> & { active?: boolean }): Promise<void> {
  await http.patch(`/api/recurring/${id}`, payload);
}

export async function deleteRecurringApi(id: string): Promise<void> {
  await http.delete(`/api/recurring/${id}`);
}

/** 切换启用状态(后端自行取反) */
export async function toggleRecurringApi(id: string, _active: boolean): Promise<void> {
  await http.patch(`/api/recurring/${id}/toggle`, {});
}

/** 贷款还款计划预览 */
export async function loanPreviewApi(data: { total: number; annualRate: number; months: number; startDate: string; method: LoanInterestMethod }): Promise<LoanPreview> {
  return http.post<LoanPreview>('/api/recurring/loan-preview', data);
}

/** 已生成的还款计划列表 */
export async function fetchRepaymentPlanApi(id: string): Promise<RepaymentPlan[]> {
  return (await http.get<RepaymentPlan[]>(`/api/recurring/${id}/plan`).catch(() => [])) ?? [];
}
