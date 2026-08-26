import { api } from './http'
import type {
  LoanInterestMethod,
  LoanPreview,
  RecurringTransaction,
  RecurringType,
  RepaymentPlan,
} from '@homibook/core'

export {
  type LoanInterestMethod,
  type LoanPreview,
  type RecurringTransaction,
  type RecurringType,
  type RepaymentPlan,
}

export const recurringApi = {
  list: (bookId: string) =>
    api.get<RecurringTransaction[]>(`/api/recurring?bookId=${bookId}`),

  get: (id: string) =>
    api.get<RecurringTransaction>(`/api/recurring/${id}`),

  create: (data: {
    accountBookId: string
    name: string
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER'
    amount: number
    remark?: string
    tags?: string[]
    accountId: string
    toAccountId?: string
    categoryCode?: string
    payer?: string
    ownerId?: string
    cron: string
    recurringType: 'PERIODIC' | 'LOAN'
    loanTotalAmount?: number
    loanInterestRate?: number
    loanInterestMethod?: 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL'
    loanStartDate?: string
    loanTermMonths?: number
    generateAll?: boolean
  }) => api.post<RecurringTransaction>('/api/recurring', data),

  update: (id: string, data: {
    name?: string
    type?: 'INCOME' | 'EXPENSE' | 'TRANSFER'
    amount?: number
    remark?: string | null
    tags?: string[]
    accountId?: string
    toAccountId?: string | null
    categoryCode?: string | null
    payer?: string | null
    cron?: string
    active?: boolean
  }) => api.patch<RecurringTransaction>(`/api/recurring/${id}`, data),

  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/api/recurring/${id}`),

  toggle: (id: string) =>
    api.patch<{ active: boolean }>(`/api/recurring/${id}/toggle`, {}),

  getPlan: (id: string) =>
    api.get<RepaymentPlan[]>(`/api/recurring/${id}/plan`),

  loanPreview: (data: {
    total: number
    annualRate: number
    months: number
    startDate: string
    method: 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL'
  }) => api.post<LoanPreview>('/api/recurring/loan-preview', data),
}
