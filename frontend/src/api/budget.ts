import { api } from './http'

export type BudgetType = 'FIXED' | 'FREE'

export interface BudgetItem {
  id: string
  accountBookId: string
  name: string
  type: BudgetType
  year: number
  month: number
  amount: number
  categoryCode: string | null
  tags: string[]
  startDate: string | null
  endDate: string | null
  remark: string | null
  actualAmount: number
  createdAt: string
  updatedAt: string
}

export const budgetApi = {
  list: (params: { bookId: string; year?: number; month?: number; type?: BudgetType }) => {
    const search = new URLSearchParams()
    search.set('bookId', params.bookId)
    if (params.year !== undefined) search.set('year', String(params.year))
    if (params.month !== undefined) search.set('month', String(params.month))
    if (params.type) search.set('type', params.type)
    return api.get<BudgetItem[]>(`/api/budgets?${search.toString()}`)
  },

  listFixed: (params: { bookId: string; year?: number; month?: number }) => {
    const search = new URLSearchParams()
    search.set('bookId', params.bookId)
    if (params.year !== undefined) search.set('year', String(params.year))
    if (params.month !== undefined) search.set('month', String(params.month))
    return api.get<BudgetItem[]>(`/api/budgets/fixed?${search.toString()}`)
  },

  listFree: (params: { bookId: string; startDate?: string; endDate?: string }) => {
    const search = new URLSearchParams()
    search.set('bookId', params.bookId)
    if (params.startDate) search.set('startDate', params.startDate)
    if (params.endDate) search.set('endDate', params.endDate)
    return api.get<BudgetItem[]>(`/api/budgets/free?${search.toString()}`)
  },

  create: (data: {
    accountBookId: string
    name: string
    type: BudgetType
    year: number
    month: number
    amount: number
    categoryCode?: string
    tags?: string[]
    startDate?: string
    endDate?: string
    remark?: string
  }) => api.post<BudgetItem>('/api/budgets', data),

  update: (id: string, data: {
    name?: string
    amount?: number
    categoryCode?: string | null
    tags?: string[]
    startDate?: string | null
    endDate?: string | null
    remark?: string | null
  }) => api.patch<BudgetItem>(`/api/budgets/${id}`, data),

  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/api/budgets/${id}`),

  batchCreate: (data: {
    accountBookId: string
    name: string
    type: BudgetType
    amount: number
    categoryCode?: string
    tags?: string[]
    months: number[]
    year: number
    startDate?: string
    endDate?: string
    remark?: string
  }) => api.post<BudgetItem[]>('/api/budgets/batch', data),

  copy: (data: {
    accountBookId: string
    sourceYear: number
    sourceMonth: number
    targetMonths: Array<{ year: number; month: number }>
  }) => api.post<{ count: number }>('/api/budgets/copy', data),

  getTags: (bookId: string) =>
    api.get<string[]>(`/api/budgets/tags?bookId=${bookId}`),

  batchUpdate: (data: {
    ids: string[]
    data: {
      amount?: number
      categoryCode?: string | null
      tags?: string[]
      startDate?: string | null
      endDate?: string | null
      remark?: string | null
    }
  }) => api.patch<{ updated: number }>('/api/budgets/batch', data),
}
