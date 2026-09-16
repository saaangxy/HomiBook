/**
 * 流水领域类型 —— 以 homibook 后端 API 响应为准(权威)。
 * 说明:mobile 的扁平展示字段(accountName/categoryName/toAccountName/counterparty 等)
 * 作为「可选派生字段」并入,便于三端统一消费。
 */

export type RecordType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

/** 收支类型全集(运行时校验用,与 RecordType 联合保持一致) */
export const RECORD_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const;

/** 是否为合法收支类型(历史数据/外部写入可能存在非法值) */
export function isRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && (RECORD_TYPES as readonly string[]).includes(value);
}

/** 收支类型归一化:非法值回落 EXPENSE(各端会按 type 查图标/颜色,非法值会直接导致渲染崩溃) */
export function normalizeRecordType(value: unknown): RecordType {
  return isRecordType(value) ? value : 'EXPENSE';
}

/** 流水记录(权威,后端响应结构) */
export interface RecordItem {
  id: string;
  accountBookId: string;
  type: RecordType;
  amount: number;
  date: string;
  remark: string | null;
  tags: string[];
  attachments?: { id: string; url: string; originalFilename: string }[];
  accountId: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  categoryCode: string | null;
  payer: string | null;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  account: { id: string; name: string; type: string };
  fromAccount: { id: string; name: string } | null;
  toAccount: { id: string; name: string } | null;
  // ── 以下为 mobile 展示派生字段(可选) ──
  accountName?: string;
  categoryName?: string;
  toAccountName?: string;
  counterparty?: string;
}

/** 收支汇总 */
export interface RecordSummary {
  income: number;
  expense: number;
  transfer: number;
  netIncome: number;
}

/** 流水分页结果 */
export interface RecordListResult {
  records: RecordItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 流水列表筛选参数 */
export interface RecordFilter {
  bookId: string;
  page?: number;
  pageSize?: number;
  type?: string; // 逗号分隔多选
  accountId?: string;
  categoryCode?: string;
  dateFrom?: string;
  dateTo?: string;
  ownerId?: string;
  payer?: string;
  amountFrom?: number;
  amountTo?: number;
  remark?: string;
  tags?: string; // 逗号分隔多选
}

/** 日历日汇总 */
export interface RecordCalendarDay {
  date: string;
  income: number;
  expense: number;
  transfer: number;
  count: number;
}

/** 月度趋势 */
export interface MonthlyTrendPoint {
  month: string;
  income: number;
  expense: number;
}

/** 分类汇总 */
export interface CategorySummary {
  categoryCode: string | null;
  categoryName: string;
  amount: number;
  type: string;
}

/** 统计分组维度(与后端查询参数 groupBy 一致) */
export type StatGroupBy = 'category' | 'ownerId' | 'accountId';

export const STAT_GROUP_BYS = ['category', 'ownerId', 'accountId'] as const;

/** 统计/余额历史粒度(与后端查询参数 granularity 一致) */
export type StatGranularity = 'daily' | 'monthly';

export const STAT_GRANULARITIES = ['daily', 'monthly'] as const;
