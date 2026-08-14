// 领域类型(镜像 frontend/src/api —— 后续对接后端时保持一致)

export type RecordType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

export interface RecordItem {
  id: string;
  type: RecordType;
  amount: number;
  date: string;
  remark: string | null;
  categoryCode: string | null;
  categoryName?: string;
  accountId: string;
  accountName?: string;
  ownerName?: string;
  tags: string[];
}

export interface RecordSummary {
  income: number;
  expense: number;
  transfer: number;
  netIncome: number;
}

export type AccountType =
  | 'BANK_DEBIT'
  | 'CREDIT_CARD'
  | 'ALIPAY'
  | 'WECHAT'
  | 'CASH'
  | 'RECHARGE_CARD'
  | 'INVESTMENT'
  | 'OTHER';

export interface AccountItem {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  initialBalance: number;
  bankName: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface BudgetItem {
  id: string;
  name: string;
  categoryCode: string | null;
  amount: number;
  actualAmount: number;
  year: number;
  month: number | null;
}

export interface Category {
  code: string;
  label: string;
  type: RecordType;
  icon: string;
}

export interface Server {
  id: string;
  name: string;
  baseUrl: string;
} // 模拟服务器配置

export interface AuthState {
  isLoggedIn: boolean;
  username: string;
  nickname: string;
  serverId: string | null;
  remember: boolean;
} // 模拟登录态

export interface RadarMetric {
  name: string;
  value: number;
  detail?: string;
  available?: boolean;
}