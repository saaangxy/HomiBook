import { api } from './http'

export interface RecurringTransaction {
  id: string
  accountBookId: string
  name: string
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER'
  amount: number
  remark: string | null
  tags: string[]
  accountId: string
  account: { id: string; name: string; type: string }
  toAccountId: string | null
  toAccount: { id: string; name: string; type: string } | null
  categoryCode: string | null
  payer: string | null
  ownerId: string
  owner: { id: string; name: string; email: string } | null
  cron: string
  active: boolean
  recurringType: 'PERIODIC' | 'LOAN'
  loanTotalAmount: number | null
  loanRemainingAmount: number | null
  loanInterestRate: number | null
  loanInterestMethod: 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL' | null
  loanStartDate: string | null
  loanTermMonths: number | null
  loanMonthlyPayment: number | null
  lastGeneratedAt: string | null
  nextGenerateAt: string | null
  createdAt: string
  updatedAt: string
  repaymentPlans?: RepaymentPlan[]
}

export interface RepaymentPlan {
  id: string
  recurringTransactionId: string
  period: number
  dueDate: string
  totalPayment: number
  principal: number
  interest: number
  remainingPrincipal: number
  status: 'PENDING' | 'GENERATED'
  generatedRecordId: string | null
}

export interface LoanPreview {
  monthlyPayment: number
  totalPayment: number
  totalInterest: number
  plan: Array<{
    period: number
    dueDate: string
    totalPayment: number
    principal: number
    interest: number
    remainingPrincipal: number
  }>
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
