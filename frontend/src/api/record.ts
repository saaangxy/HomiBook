import { api } from './http'
import type { DedupMatchFields, DedupScopeFilter, DuplicateMergeChoice, RecordSummary, RecordType } from '@homibook/core'

export { type RecordSummary, type RecordType }

export interface AttachmentUploadResult {
  id: string         // RecordAttachment ID
  url: string        // 相对路径，如 /api/uploads/xxx.png
  fullUrl: string    // 完整路径，如 http://localhost:3002/api/uploads/xxx.png
  originalFilename: string
}

export interface RecordItem {
  id: string
  accountBookId: string
  type: RecordType
  amount: number
  date: string
  remark: string | null
  tags: string[]
  attachments: { id: string; url: string; originalFilename: string }[]
  accountId: string
  fromAccountId: string | null
  toAccountId: string | null
  categoryCode: string | null
  payer: string | null
  ownerId: string
  ownerName: string
  /** 平账时间:非空表示已平账,不计入收支统计与账户余额 */
  offsetAt?: string | null
  createdAt: string
  updatedAt: string
  account: { id: string; name: string; type: string }
  fromAccount: { id: string; name: string } | null
  toAccount: { id: string; name: string } | null
}

/** 平账配对结果:组内收入合计 = 支出合计 */
export interface OffsetGroupDTO {
  key: string
  amount: number
  spanDays: number
  income: RecordItem[]
  expense: RecordItem[]
}

export interface RecordListResult {
  records: RecordItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const recordApi = {
  list: (params: {
    bookId: string
    page?: number
    pageSize?: number
    type?: string        // 逗号分隔多选
    accountId?: string
    /** 转账的转入账户(逗号分隔多选,仅转账记录有效) */
    toAccountId?: string
    categoryCode?: string
    dateFrom?: string
    dateTo?: string
    ownerId?: string
    payer?: string
    amountFrom?: number
    amountTo?: number
    remark?: string
    tags?: string       // 逗号分隔多选
    /** 平账状态:不传 = 全部;'pending' = 未平账;'offset' = 已平账 */
    offsetState?: 'pending' | 'offset'
  }) => api.get<RecordListResult>('/api/records?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  ).toString()),

  summary: (params: {
    bookId: string
    type?: string
    accountId?: string
    /** 转账的转入账户(逗号分隔多选,仅转账记录有效) */
    toAccountId?: string
    categoryCode?: string
    dateFrom?: string
    dateTo?: string
    ownerId?: string
    payer?: string
    amountFrom?: number
    amountTo?: number
    remark?: string
    tags?: string       // 逗号分隔多选
    /** 平账状态:不传 = 全部;'pending' = 未平账;'offset' = 已平账 */
    offsetState?: 'pending' | 'offset'
  }) => api.get<RecordSummary>('/api/records/summary?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  ).toString()),

  create: (data: {
    accountBookId: string
    type: RecordType
    amount: number
    date: string
    remark?: string
    tags?: string[]
    attachmentIds?: string[]
    accountId: string
    fromAccountId?: string
    toAccountId?: string
    categoryCode?: string
    payer?: string
    ownerId?: string
  }) => api.post<RecordItem>('/api/records', data),

  update: (id: string, data: {
    type?: RecordType
    amount?: number
    date?: string
    remark?: string
    tags?: string[]
    attachmentIds?: string[]
    accountId?: string
    fromAccountId?: string
    toAccountId?: string
    categoryCode?: string
    payer?: string
    ownerId?: string
  }) => api.patch<RecordItem>(`/api/records/${id}`, data),

  batchUpdate: (ids: string[], data: {
    type?: string
    amount?: number
    date?: string
    remark?: string | null
    tags?: string[]
    accountId?: string
    fromAccountId?: string
    toAccountId?: string
    categoryCode?: string | null
    payer?: string | null
    ownerId?: string | null
  }) =>
    api.patch<{ success: boolean; updated: number }>('/api/records/batch', { ids, data }),

  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/api/records/${id}`),

  batchDelete: (ids: string[]) =>
    api.post<{ success: boolean; deleted: number }>('/api/records/batch-delete', { ids }),

  /**
   * 平账 / 取消平账。
   * 平账后这批记录不计入收支统计、账户余额与报表(记录保留,可随时取消)。
   * 典型场景:购物 100(支出) + 退款 100(收入),两条都平掉后总额不再虚高。
   */
  batchOffset: (ids: string[], offset: boolean) =>
    api.post<{ updated: number; offset: boolean }>('/api/records/offset', { ids, offset }),

  /** 手动平账：以一条记录为锚点，返回能和它配平的候选组（锚点 + 对侧 1~5 笔） */
  offsetAnchorGroups: (params: {
    bookId: string
    anchorId: string
    windowDays?: number | null
    sameAccount?: boolean
    sameOwner?: boolean
    minRemarkSimilarity?: number
  }) =>
    api.post<{ anchor: RecordItem; scanned: number; truncated: boolean; groups: OffsetGroupDTO[] }>(
      '/api/records/offset/anchor-groups',
      params,
    ),

  /** 平账配对预览：金额相等的一收一支组合（1:1 优先，其次单侧拆 1:N） */
  offsetPreview: (params: {
    bookId: string
    /** 组内时间跨度上限(天)；null = 不限 */
    windowDays?: number | null
    sameAccount?: boolean
    sameOwner?: boolean
    /** 备注相似度阈值(0~1);<=0 不启用 */
    minRemarkSimilarity?: number
    type?: string
    accountId?: string
    categoryCode?: string
    dateFrom?: string
    dateTo?: string
    amountFrom?: number
    amountTo?: number
    remark?: string
  }) =>
    api.post<{ scanned: number; truncated: boolean; groups: OffsetGroupDTO[] }>(
      '/api/records/offset/preview',
      params,
    ),

  /** 检测重复。filters 为**检测范围**筛选(时间/类型/金额区间),与 matchFields(怎么算同一笔)独立 */
  detectDuplicates: (
    bookId: string,
    matchFields: { date: 'exact' | 'minute' | 'date' | null; type: boolean; accountId: boolean; payer: boolean; amount: boolean },
    filters?: Partial<DedupScopeFilter>,
    /** 备注相似度阈值(0~1);<=0 不启用 —— 组内与首条不相似的记录会被剔出该组 */
    minRemarkSimilarity?: number,
  ) =>
    api.post<{ groups: Array<{ key: string; count: number; records: RecordItem[] }>; totalDuplicates: number }>(
      '/api/records/detect-duplicates',
      { bookId, matchFields, filters, minRemarkSimilarity },
    ),

  /**
   * 合并重复记录(可一次提交多组)。keepId 为保留记录,choices 缺省 = 用保留记录的值。
   * 服务端会用同一份 matchFields 重算分组,并按 core 的契约收敛字段(备注拼接、附件并集迁移)。
   */
  mergeDuplicates: (
    bookId: string,
    matchFields: DedupMatchFields,
    groups: Array<{
      keepId: string
      mergeIds: string[]
      choices?: DuplicateMergeChoice
    }>,
  ) =>
    api.post<{ success: boolean; mergedGroups: number; mergedRecords: number; keepIds: string[] }>(
      '/api/records/merge-duplicates',
      { bookId, matchFields, groups },
    ),

  clone: (id: string) =>
    api.post<RecordItem>(`/api/records/${id}/clone`, {}),

  calendar: (params: { bookId: string; year: number; month: number }) =>
    api.get<Array<{ date: string; income: number; expense: number; transfer: number; count: number }>>('/api/records/calendar?' + new URLSearchParams({
      bookId: params.bookId,
      year: String(params.year),
      month: String(params.month),
    }).toString()),

  uploadAttachment: (file: File): Promise<AttachmentUploadResult> =>
    api.uploadFile('/api/records/upload', file),

  getTags: (bookId: string) =>
    api.get<string[]>('/api/records/tags?' + new URLSearchParams({ bookId }).toString()),

  categorySummary: (params: {
    bookId: string
    type?: string
    accountId?: string
    categoryCode?: string
    dateFrom?: string
    dateTo?: string
    ownerId?: string
    payer?: string
    amountFrom?: number
    amountTo?: number
    remark?: string
    tags?: string
  }) => api.get<Array<{ categoryCode: string | null; categoryName: string; amount: number; type: string }>>(
    '/api/records/category-summary?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    ).toString()),

  monthlyTrend: (params: {
    bookId: string
    dateFrom?: string
    dateTo?: string
    accountId?: string
    categoryCode?: string
    ownerId?: string
    tags?: string
  }) => api.get<Array<{ month: string; income: number; expense: number }>>(
    '/api/records/monthly-trend?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    ).toString()),

  categoryTrend: (params: {
    bookId: string
    type?: string
    granularity: 'monthly' | 'daily'
    year?: number
    month?: number
    dateFrom?: string
    dateTo?: string
    accountId?: string
    ownerId?: string
    tags?: string
  }) => api.get<{
    periods: string[]
    categories: Array<{ code: string | null; name: string; data: number[] }>
  }>('/api/records/category-trend?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  ).toString()),

  groupSummary: (params: {
    bookId: string
    type: string
    groupBy: 'category' | 'ownerId' | 'accountId'
    dateFrom?: string
    dateTo?: string
    accountId?: string
    ownerId?: string
    categoryCode?: string
    tags?: string
  }) => api.get<Array<{ key: string; label: string; amount: number }>>(
    '/api/records/group-summary?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    ).toString()),
}