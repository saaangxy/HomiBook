import type { AccountItem, BudgetItem, Category, Ledger, LedgerMember, RecordItem, RecordSummary, ShareCodeItem } from '@/types';
import { http, getBaseUrl, uploadFileNative } from './http';
import type {
  AccountItem as CoreAccount,
  BookItem,
  BookMember,
  BudgetItem as CoreBudget,
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
    ownerId: r.ownerId ?? undefined,
    ownerName: r.ownerName,
    tags: r.tags ?? [],
    attachments: r.attachments ?? [],
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
    tags: b.tags ?? [],
    startDate: b.startDate,
    endDate: b.endDate,
    remark: b.remark,
  };
}

function toLedger(b: BookItem): Ledger {
  return {
    id: b.id,
    name: b.name,
    icon: '📒',
    memberCount: b.memberCount ?? 1,
    role: b.role?.toUpperCase() as Ledger['role'],
    shareCode: b.shareCode || undefined,
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
  ownerId?: string;
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

/** 分页查询(含 total,统计详情弹层用) */
export async function fetchRecordsPaged(bookId: string, opts?: RecordQuery): Promise<{ records: RecordItem[]; total: number }> {
  const res = await http.get<{ records: CoreRecord[]; total: number; page: number; pageSize: number; totalPages: number }>(
    '/api/records/',
    {
      query: {
        bookId,
        page: opts?.page ?? 1,
        pageSize: opts?.pageSize ?? 20,
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
        ownerId: opts?.ownerId,
      },
    },
  );
  return { records: (res.records ?? []).map(toRecordItem), total: res.total ?? 0 };
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

export async function fetchSummary(bookId: string, opts?: { dateFrom?: string; dateTo?: string; type?: string; categoryCode?: string }): Promise<RecordSummary> {
  const res = await http.get<CoreSummary>('/api/records/summary', {
    query: {
      bookId,
      page: 1,
      pageSize: 1,
      dateFrom: opts?.dateFrom,
      dateTo: opts?.dateTo,
      type: opts?.type,
      categoryCode: opts?.categoryCode,
    },
  });
  return {
    income: res.income ?? 0,
    expense: res.expense ?? 0,
    transfer: res.transfer ?? 0,
    netIncome: res.netIncome ?? 0,
  };
}

/** 分组汇总(饼图数据:分类/归属/账户占比),金额降序由调用方处理 */
export interface GroupSummaryItem {
  key: string;
  label: string;
  amount: number;
}

export async function fetchGroupSummary(bookId: string, params: {
  type: string;
  groupBy: 'category' | 'ownerId' | 'accountId';
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  ownerId?: string;
  categoryCode?: string;
  tags?: string;
}): Promise<GroupSummaryItem[]> {
  const res = await http.get<GroupSummaryItem[]>('/api/records/group-summary', { query: { bookId, ...params } });
  return (res ?? []).sort((a, b) => b.amount - a.amount);
}

/** 分类趋势(堆叠柱图:yearly→按月,monthly/free→按日) */
export interface CategoryTrendResult {
  periods: string[];
  categories: { code: string | null; name: string; data: number[] }[];
}

export async function fetchCategoryTrend(bookId: string, params: {
  type?: string;
  granularity: 'monthly' | 'daily';
  year?: number;
  month?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<CategoryTrendResult> {
  const res = await http.get<CategoryTrendResult>('/api/records/category-trend', { query: { bookId, ...params } });
  return { periods: res?.periods ?? [], categories: res?.categories ?? [] };
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
  /** 流水附件(全量覆盖语义,与 web 一致) */
  attachmentIds?: string[];
}

export async function createRecord(bookId: string, payload: RecordCreatePayload): Promise<void> {
  await http.post('/api/records/', { ...payload, accountBookId: bookId });
}

export async function updateRecordApi(bookId: string, id: string, payload: Partial<RecordCreatePayload>): Promise<void> {
  await http.patch(`/api/records/${id}`, payload);
}

/** 上传流水附件(POST /api/records/upload,multipart),返回附件 id/url */
export interface RecordAttachmentUpload {
  id: string;
  url: string;
  fullUrl: string;
  originalFilename: string;
}

export async function uploadRecordAttachment(uri: string, fileName: string, mimeType: string): Promise<RecordAttachmentUpload> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error('请先配置服务器并登录');
  return uploadFileNative<RecordAttachmentUpload>(`${baseUrl}/api/records/upload`, uri, mimeType);
}

export async function deleteRecordApi(bookId: string, id: string): Promise<void> {
  await http.delete(`/api/records/${id}`);
}

export async function fetchMonthlyTrend(bookId: string, dateFrom?: string, dateTo?: string) {
  const res = await http.get<MonthlyTrendPoint[]>('/api/records/monthly-trend', { query: { bookId, dateFrom, dateTo } });
  return {
    months: (res ?? []).map((p) => p.month),
    income: (res ?? []).map((p) => p.income ?? 0),
    expense: (res ?? []).map((p) => p.expense ?? 0),
  };
}

/** 账户余额历史(按月/按日),资产净值趋势用(对齐 web accountApi.balanceHistory) */
export interface BalanceHistoryItem {
  accountId: string;
  accountName: string;
  balances: { date: string; balance: number }[];
}

export async function fetchBalanceHistory(bookId: string, params: {
  accountIds?: string;
  granularity: 'daily' | 'monthly';
  dateFrom: string;
  dateTo: string;
}): Promise<BalanceHistoryItem[]> {
  return (await http.get<BalanceHistoryItem[]>('/api/accounts/balance-history', { query: { bookId, ...params } }).catch(() => [])) ?? [];
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

export interface BalanceAdjustment {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  balanceAfter: number;
  remark?: string;
}

/** 余额调整历史 */
export async function listAdjustmentsApi(accountId: string): Promise<BalanceAdjustment[]> {
  return (await http.get<BalanceAdjustment[]>(`/api/accounts/${accountId}/adjustments`).catch(() => [])) ?? [];
}

/** 创建余额调整(同步更新账户余额) */
export async function createAdjustmentApi(accountId: string, data: { date: string; balanceAfter: number; remark?: string }): Promise<void> {
  await http.post(`/api/accounts/${accountId}/adjustments`, data);
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

export async function updateBudgetApi(id: string, payload: BudgetUpdatePayload): Promise<void> {
  await http.patch(`/api/budgets/${id}`, payload);
}

/** 编辑预算可清空字段(null=清空) */
export interface BudgetUpdatePayload {
  name?: string;
  amount?: number;
  categoryCode?: string | null;
  tags?: string[];
  startDate?: string | null;
  endDate?: string | null;
  remark?: string | null;
}

export async function deleteBudgetApi(id: string): Promise<void> {
  await http.delete(`/api/budgets/${id}`);
}

/** 批量创建预算(一个预算同时生成多个指定月份) */
export async function batchCreateBudgetApi(
  bookId: string,
  data: {
    name: string; type: 'FIXED' | 'FREE'; amount: number; categoryCode?: string; tags?: string[];
    year: number; months: number[]; startDate?: string; endDate?: string; remark?: string;
  },
): Promise<void> {
  await http.post('/api/budgets/batch', { ...data, accountBookId: bookId });
}

/** 批量编辑预算(仅提交传入的字段) */
export async function batchUpdateBudgetApi(data: { ids: string[]; data: BudgetUpdatePayload }): Promise<void> {
  await http.patch('/api/budgets/batch', data);
}

/** 复制预算:把 sourceYear/sourceMonth 的预算复制到 targetMonths */
export async function copyBudgetApi(bookId: string, data: { sourceYear: number; sourceMonth: number; targetMonths: Array<{ year: number; month: number }> }): Promise<void> {
  await http.post('/api/budgets/copy', { ...data, accountBookId: bookId });
}

/** 账本下所有记录的标签 */
export async function fetchRecordTags(bookId: string): Promise<string[]> {
  return (await http.get<string[]>(`/api/records/tags?bookId=${bookId}`).catch(() => [])) ?? [];
}

/** 账本下预算的标签 */
export async function fetchBudgetTags(bookId: string): Promise<string[]> {
  return (await http.get<string[]>(`/api/budgets/tags?bookId=${bookId}`).catch(() => [])) ?? [];
}

// ── 分类 ──

export async function fetchCategories(): Promise<Category[]> {
  const income = await http.get<{ code: string; label: string; order: number }[]>('/api/settings/dictionary/transaction_category_income').catch(() => []);
  const expense = await http.get<{ code: string; label: string; order: number }[]>('/api/settings/dictionary/transaction_category_expense').catch(() => []);
  const transfer = await http.get<{ code: string; label: string; order: number }[]>('/api/settings/dictionary/transaction_category_transfer').catch(() => []);
  // 分类不再带 logo/emoji 图标(icon 置空)
  const map = (items: { code: string; label: string }[], type: Category['type']): Category[] =>
    items.map((d) => ({ code: d.code, label: d.label, type, icon: '' }));
  return [...map(income, 'INCOME'), ...map(expense, 'EXPENSE'), ...map(transfer, 'TRANSFER')];
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
    userId: m.user?.id ?? m.userId ?? m.id,
    nickname: m.user?.nickname ?? m.nickname ?? '成员',
    role: m.role === 'admin' || m.role === 'owner' ? 'OWNER' : 'MEMBER',
    joinedAt: m.joinedAt,
  }));
}

// ── 账本管理(成员/分享码/加入退出) ──

/** 添加成员(按邮箱) */
export async function addBookMemberApi(bookId: string, email: string): Promise<void> {
  await http.post(`/api/books/${bookId}/members`, { email });
}

/** 移除成员(按成员 id) */
export async function removeBookMemberApi(bookId: string, memberId: string): Promise<void> {
  await http.delete(`/api/books/${bookId}/members/${memberId}`);
}

/** 修改成员角色 OWNER/MEMBER */
export async function updateBookMemberRoleApi(bookId: string, memberId: string, role: string): Promise<void> {
  await http.patch(`/api/books/${bookId}/members/${memberId}/role`, { role });
}

/** 生成分享码 */
export async function generateShareCodeApi(bookId: string, expiresInHours?: number): Promise<ShareCodeItem> {
  return http.post<ShareCodeItem>(`/api/books/${bookId}/share-codes`, { expiresInHours });
}

/** 分享码列表 */
export async function listShareCodesApi(bookId: string): Promise<ShareCodeItem[]> {
  return (await http.get<ShareCodeItem[]>(`/api/books/${bookId}/share-codes`).catch(() => [])) ?? [];
}

/** 删除分享码 */
export async function deleteShareCodeApi(bookId: string, codeId: string): Promise<void> {
  await http.delete(`/api/books/${bookId}/share-codes/${codeId}`);
}

/** 校验分享码,返回账本信息 */
export async function lookupShareCodeApi(code: string): Promise<{ bookId: string; bookName: string; code: string; expiresAt: string | null } | null> {
  return (await http.get<{ bookId: string; bookName: string; code: string; expiresAt: string | null }>(`/api/books/share-codes/${code}`).catch(() => null)) ?? null;
}

/** 通过分享码加入账本 */
export async function joinBookByCodeApi(code: string): Promise<void> {
  await http.post('/api/books/join', { code });
}
