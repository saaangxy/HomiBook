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
  visibility: 'PUBLIC' | 'PRIVATE';
  status: 'ACTIVE' | 'ARCHIVED';
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
