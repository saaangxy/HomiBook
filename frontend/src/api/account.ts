import { api } from './http'

export type AccountType =
  | 'BANK_DEBIT'
  | 'CREDIT_CARD'
  | 'ALIPAY'
  | 'WECHAT'
  | 'CASH'
  | 'RECHARGE_CARD'
  | 'INVESTMENT'
  | 'OTHER'

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK_DEBIT: '借记卡',
  CREDIT_CARD: '信用卡',
  ALIPAY: '支付宝',
  WECHAT: '微信',
  CASH: '现金',
  RECHARGE_CARD: '充值卡',
  INVESTMENT: '投资账户',
  OTHER: '其他',
}

export interface AccountItem {
  id: string
  accountBookId: string
  ownerId: string
  ownerName: string
  name: string
  type: AccountType
  currency: string
  balance: number | undefined  // PRIVATE 非归属人时为 undefined
  initialBalance: number | undefined
  balanceAt: string | null
  computedBalance: number  // 当前直接 = balance，后续流水模块会加入 Record 计算
  accountNo: string | null
  bankName: string | null
  visibility: 'PUBLIC' | 'PRIVATE'
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

export interface BalanceAdjustment {
  id: string
  accountId: string
  date: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  remark: string | null
  createdAt: string
}

export const accountApi = {
  list: (bookId: string) =>
    api.get<AccountItem[]>(`/api/accounts?bookId=${bookId}`),

  create: (data: {
    accountBookId: string
    name: string
    type: AccountType
    currency?: string
    initialBalance?: number
    accountNo?: string
    bankName?: string
    visibility?: 'PUBLIC' | 'PRIVATE'
  }) => api.post<AccountItem>('/api/accounts', data),

  get: (id: string) =>
    api.get<AccountItem>(`/api/accounts/${id}`),

  update: (id: string, data: {
    name?: string
    type?: AccountType
    visibility?: 'PUBLIC' | 'PRIVATE'
    status?: 'ACTIVE' | 'ARCHIVED'
    accountNo?: string
    bankName?: string
  }) => api.patch<AccountItem>(`/api/accounts/${id}`, data),

  delete: (id: string) =>
    api.delete(`/api/accounts/${id}`),

  listAdjustments: (accountId: string) =>
    api.get<BalanceAdjustment[]>(`/api/accounts/${accountId}/adjustments`),

  createAdjustment: (accountId: string, data: {
    date: string
    balanceAfter: number
    remark?: string
  }) => api.post<BalanceAdjustment>(`/api/accounts/${accountId}/adjustments`, data),
}
