/** 账户领域类型(权威,以后端响应为准) */

export type AccountType =
  | 'BANK_DEBIT'
  | 'CREDIT_CARD'
  | 'ALIPAY'
  | 'WECHAT'
  | 'CASH'
  | 'RECHARGE_CARD'
  | 'INVESTMENT'
  | 'OTHER';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK_DEBIT: '借记卡',
  CREDIT_CARD: '信用卡',
  ALIPAY: '支付宝',
  WECHAT: '微信',
  CASH: '现金',
  RECHARGE_CARD: '充值卡',
  INVESTMENT: '投资账户',
  OTHER: '其他',
};

/** 账户类型全集(运行时校验用,与 AccountType 联合保持一致) */
export const ACCOUNT_TYPES = [
  'BANK_DEBIT', 'CREDIT_CARD', 'ALIPAY', 'WECHAT', 'CASH', 'RECHARGE_CARD', 'INVESTMENT', 'OTHER',
] as const;

/** 是否为合法账户类型(历史数据/外部写入可能存在非法值,如 "BANK" 而非 "BANK_DEBIT") */
export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

/** 账户类型归一化:非法值回落 OTHER(各端会按 type 查图标/标签,非法值会直接导致渲染崩溃) */
export function normalizeAccountType(value: unknown): AccountType {
  return isAccountType(value) ? value : 'OTHER';
}

/** 账户可见性全集(与后端 z.enum 保持一致) */
export const ACCOUNT_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;

export type AccountVisibility = (typeof ACCOUNT_VISIBILITIES)[number];

export const ACCOUNT_VISIBILITY_LABELS: Record<AccountVisibility, string> = {
  PUBLIC: '共享',
  PRIVATE: '私有',
};

/** 账户状态全集 */
export const ACCOUNT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  ACTIVE: '启用',
  ARCHIVED: '归档',
};

export interface AccountItem {
  id: string;
  accountBookId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number | undefined; // PRIVATE 非归属人时为 undefined
  initialBalance: number | undefined;
  balanceAt: string | null;
  computedBalance: number;
  accountNo: string | null;
  bankName: string | null;
  visibility: AccountVisibility;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BalanceAdjustment {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  remark: string | null;
  createdAt: string;
}
