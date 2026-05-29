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
  tag: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface BudgetDetail {
  id: string
  name: string
  type: BudgetType
  year: number
  month: number
  amount: number
  categoryCode: string | null
  tag: string | null
  remark: string | null
  actualAmount: number
  usagePercent: number
  remaining: number
}

export interface BudgetSummary {
  totalBudget: number
  totalActual: number
  totalRemaining: number
  totalUsagePercent: number
  details: BudgetDetail[]
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

  create: (data: {
    accountBookId: string
    name: string
    type: BudgetType
    year: number
    month: number
    amount: number
    categoryCode?: string
    remark?: string
  }) => api.post<BudgetItem>('/api/budgets', data),

  update: (id: string, data: {
    name?: string
    amount?: number
    categoryCode?: string | null
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
    months: number[]
    year: number
    remark?: string
  }) => api.post<BudgetItem[]>('/api/budgets/batch', data),

  copy: (data: {
    accountBookId: string
    sourceYear: number
    sourceMonth: number
    targetMonths: Array<{ year: number; month: number }>
  }) => api.post<{ count: number }>('/api/budgets/copy', data),

  summary: (params: { bookId: string; year: number; month?: number }) => {
    const search = new URLSearchParams()
    search.set('bookId', params.bookId)
    search.set('year', String(params.year))
    if (params.month !== undefined) search.set('month', String(params.month))
    return api.get<BudgetSummary>(`/api/budgets/summary?${search.toString()}`)
  },

  getTags: (bookId: string) =>
    api.get<string[]>(`/api/budgets/tags?bookId=${bookId}`),

  batchUpdate: (data: {
    ids: string[]
    data: {
      amount?: number
      categoryCode?: string | null
      remark?: string | null
    }
  }) => api.patch<{ updated: number }>('/api/budgets/batch', data),
}
