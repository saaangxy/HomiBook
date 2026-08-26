import type { AccountItem, BudgetItem, Category, Ledger, LedgerMember, RadarMetric, RecordItem, RecordSummary } from '@/types';
import { http } from './http';
import type {
  AccountItem as CoreAccount,
  BookItem,
  BookMember,
  BudgetItem as CoreBudget,
  CategorySummary,
  MonthlyTrendPoint,
  RecordItem as CoreRecord,
  RecordSummary as CoreSummary,
} from '@homibook/core';

// 数据访问层 —— 真实后端 API 对接
// 后端权威类型 -> mobile 扁平展示类型

// ── 类型映射 ──
function toRecordItem(r: CoreRecord): RecordItem {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    // 保留后端完整日期(含时分秒,与 web 端一致);按日匹配处用 date.slice(0,10)
    date: r.date || '',
    remark: r.remark ?? null,
    categoryCode: r.categoryCode ?? null,
    // 分类名:后端字典 code 即中文 label(如"餐饮"),直接用作展示名
    categoryName: r.categoryCode ?? undefined,
    accountId: r.accountId,
    accountName: r.account?.name ?? r.accountName,
    toAccountId: r.toAccountId ?? undefined,
    toAccountName: r.toAccount?.name ?? r.toAccountName,
    counterparty: r.payer ?? undefined,
    ownerName: r.ownerName,
    tags: r.tags ?? [],
  };
}

function toAccountItem(a: CoreAccount): AccountItem {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    balance: a.computedBalance ?? 0,
    initialBalance: a.initialBalance ?? 0,
    bankName: a.bankName ?? null,
    accountNo: a.accountNo ?? undefined,
    status: a.status,
  };
}

function toBudgetItem(b: CoreBudget): BudgetItem {
  return {
    id: b.id,
    name: b.name,
    type: b.type,
    categoryCode: b.categoryCode ?? null,
    amount: b.amount,
    actualAmount: b.actualAmount ?? 0,
    year: b.year,
    month: b.month,
  };
}

function toLedger(b: BookItem): Ledger {
  return {
    id: b.id,
    name: b.name,
    icon: '📒',
    memberCount: b.memberCount ?? 1,
    role: b.role?.toUpperCase() as Ledger['role'],
  };
}

// ── 流水 ──

export interface RecordQuery {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  types?: string[]; // 逗号分隔多选
  accountId?: string;
  categoryCode?: string;
  amountFrom?: number;
  amountTo?: number;
  remark?: string;
  tags?: string;
  payer?: string;
}

export async function fetchRecords(bookId: string, opts?: RecordQuery): Promise<RecordItem[]> {
  const res = await http.get<{ records: CoreRecord[]; total: number; page: number; pageSize: number; totalPages: number }>(
    '/api/records/',
    {
      query: {
        bookId,
        page: opts?.page ?? 1,
        pageSize: opts?.pageSize ?? 100,
        dateFrom: opts?.dateFrom,
        dateTo: opts?.dateTo,
        type: opts?.types?.length ? opts.types.join(',') : undefined,
        accountId: opts?.accountId,
        categoryCode: opts?.categoryCode,
        amountFrom: opts?.amountFrom,
        amountTo: opts?.amountTo,
        remark: opts?.remark,
        tags: opts?.tags,
        payer: opts?.payer,
      },
    },
  );
  return (res.records ?? []).map(toRecordItem);
}

/** 月视图每日汇总(GET /api/records/calendar) */
export interface CalendarDay {
  date: string;
  income: number;
  expense: number;
  transfer: number;
  count: number;
}

export async function fetchCalendar(bookId: string, year: number, month: number): Promise<CalendarDay[]> {
  const res = await http.get<CalendarDay[]>('/api/records/calendar', { query: { bookId, year, month } });
  return res ?? [];
}

export async function fetchSummary(bookId: string): Promise<RecordSummary> {
  const res = await http.get<CoreSummary>('/api/records/summary', {
    query: { bookId, page: 1, pageSize: 1 },
  });
  return {
    income: res.income ?? 0,
    expense: res.expense ?? 0,
    transfer: res.transfer ?? 0,
    netIncome: res.netIncome ?? 0,
  };
}

export interface RecordCreatePayload {
  accountBookId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amount: number;
  date: string;
  remark?: string | null;
  tags?: string[];
  accountId: string;
  fromAccountId?: string;
  toAccountId?: string;
  categoryCode?: string | null;
  payer?: string | null;
}

export async function createRecord(bookId: string, payload: RecordCreatePayload): Promise<void> {
  await http.post('/api/records/', { ...payload, accountBookId: bookId });
}

export async function updateRecordApi(bookId: string, id: string, payload: Partial<RecordCreatePayload>): Promise<void> {
  await http.patch(`/api/records/${id}`, payload);
}

export async function deleteRecordApi(bookId: string, id: string): Promise<void> {
  await http.delete(`/api/records/${id}`);
}

export async function fetchMonthlyTrend(bookId: string) {
  const res = await http.get<MonthlyTrendPoint[]>('/api/records/monthly-trend', { query: { bookId } });
  return {
    income: (res ?? []).map((p) => p.income ?? 0),
    expense: (res ?? []).map((p) => p.expense ?? 0),
  };
}

export async function fetchRadar(bookId: string, type?: string): Promise<RadarMetric[]> {
  const res = await http
    .get<CategorySummary[]>('/api/records/category-summary', { query: { bookId, type: type ?? 'EXPENSE' } })
    .catch(() => []);
  return (res ?? []).map((c) => ({ name: c.categoryName, value: c.amount }));
}

// ── 账户 ──

export async function fetchAccounts(bookId: string): Promise<AccountItem[]> {
  const res = await http.get<CoreAccount[]>('/api/accounts/', { query: { bookId } });
  return (res ?? []).map(toAccountItem);
}

export interface AccountCreatePayload {
  name: string;
  type: string;
  currency?: string;
  initialBalance?: number;
  accountNo?: string;
  bankName?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
}

export async function createAccountApi(bookId: string, payload: AccountCreatePayload): Promise<void> {
  await http.post('/api/accounts/', { ...payload, accountBookId: bookId });
}

export interface AccountUpdatePayload {
  name?: string;
  type?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
  status?: 'ACTIVE' | 'ARCHIVED';
  accountNo?: string;
  bankName?: string;
}

export async function updateAccountApi(id: string, payload: AccountUpdatePayload): Promise<void> {
  await http.patch(`/api/accounts/${id}`, payload);
}

export async function deleteAccountApi(id: string): Promise<void> {
  await http.delete(`/api/accounts/${id}`);
}

// ── 预算 ──

export async function fetchBudgets(bookId: string): Promise<BudgetItem[]> {
  const [fixed, free] = await Promise.all([
    http.get<CoreBudget[]>('/api/budgets/fixed', { query: { bookId } }).catch(() => []),
    http.get<CoreBudget[]>('/api/budgets/free', { query: { bookId } }).catch(() => []),
  ]);
  return [...(fixed ?? []), ...(free ?? [])].map(toBudgetItem);
}

export interface BudgetCreatePayload {
  name: string;
  type: 'FIXED' | 'FREE';
  year: number;
  month: number; // 0=全年(FREE)
  amount: number;
  categoryCode?: string;
  tags?: string[];
  startDate?: string;
  endDate?: string;
  remark?: string;
}

export async function createBudgetApi(bookId: string, payload: BudgetCreatePayload): Promise<void> {
  await http.post('/api/budgets/', { ...payload, accountBookId: bookId });
}

export async function updateBudgetApi(id: string, payload: Partial<BudgetCreatePayload>): Promise<void> {
  await http.patch(`/api/budgets/${id}`, payload);
}

export async function deleteBudgetApi(id: string): Promise<void> {
  await http.delete(`/api/budgets/${id}`);
}

// ── 分类 ──

export async function fetchCategories(): Promise<Category[]> {
  const income = await http.get<{ code: string; label: string; order: number }[]>('/api/settings/dictionary/transaction_category_income').catch(() => []);
  const expense = await http.get<{ code: string; label: string; order: number }[]>('/api/settings/dictionary/transaction_category_expense').catch(() => []);
  // 分类不再带 logo/emoji 图标(icon 置空)
  const map = (items: { code: string; label: string }[], type: 'INCOME' | 'EXPENSE'): Category[] =>
    items.map((d) => ({ code: d.code, label: d.label, type, icon: '' }));
  return [...map(income, 'INCOME'), ...map(expense, 'EXPENSE')];
}

// ── 账本 ──

export async function fetchBooks(): Promise<Ledger[]> {
  const res = await http.get<BookItem[]>('/api/books/');
  return (res ?? []).map(toLedger);
}

export async function createBookApi(name: string): Promise<void> {
  await http.post('/api/books/', { name });
}

export async function updateBookApi(id: string, payload: { name?: string }): Promise<void> {
  await http.patch(`/api/books/${id}`, payload);
}

export async function deleteBookApi(id: string): Promise<void> {
  await http.delete(`/api/books/${id}`);
}

export async function fetchBookMembers(bookId: string): Promise<LedgerMember[]> {
  const res = await http.get<BookMember[]>(`/api/books/${bookId}/members`).catch(() => []);
  return (res ?? []).map((m) => ({
    id: m.id,
    nickname: m.user?.nickname ?? m.nickname ?? '成员',
    role: m.role === 'admin' || m.role === 'owner' ? 'OWNER' : 'MEMBER',
    joinedAt: m.joinedAt,
  }));
}
