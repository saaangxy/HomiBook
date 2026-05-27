import { api } from './http'

export interface AttachmentUploadResult {
  id: string         // RecordAttachment ID
  url: string        // 相对路径，如 /api/uploads/xxx.png
  fullUrl: string    // 完整路径，如 http://localhost:3002/api/uploads/xxx.png
  originalFilename: string
}

export type RecordType = 'INCOME' | 'EXPENSE' | 'TRANSFER'

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
  createdAt: string
  updatedAt: string
  account: { id: string; name: string; type: string }
  fromAccount: { id: string; name: string } | null
  toAccount: { id: string; name: string } | null
}

export interface RecordSummary {
  income: number
  expense: number
  transfer: number
  netIncome: number
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
    categoryCode?: string
    dateFrom?: string
    dateTo?: string
    ownerId?: string
    payer?: string
    amountFrom?: number
    amountTo?: number
    remark?: string
  }) => api.get<RecordListResult>('/api/records?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  ).toString()),

  summary: (params: { bookId: string; dateFrom?: string; dateTo?: string }) =>
    api.get<RecordSummary>('/api/records/summary?' + new URLSearchParams(
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

  batchUpdate: (ids: string[], data: { type?: string; categoryCode?: string; remark?: string }) =>
    api.patch<{ success: boolean; updated: number }>('/api/records/batch', { ids, data }),

  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/api/records/${id}`),

  clone: (id: string) =>
    api.post<RecordItem>(`/api/records/${id}/clone`, {}),

  calendar: (params: { bookId: string; year: number; month: number }) =>
    api.get<Array<{ date: string; income: number; expense: number; count: number }>>('/api/records/calendar?' + new URLSearchParams({
      bookId: params.bookId,
      year: String(params.year),
      month: String(params.month),
    }).toString()),

  uploadAttachment: (file: File): Promise<AttachmentUploadResult> =>
    api.uploadFile('/api/records/upload', file),
}