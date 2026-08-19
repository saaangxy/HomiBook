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
  toAccountId?: string;
  toAccountName?: string;
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
  accountNo?: string;
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

export interface Ledger {
  id: string;
  name: string;
  icon: string; // emoji
  memberCount: number;
} // 账本

export type LedgerMenu = {
  icon: string;
  label: string;
  to?: string;
};

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

// 固定收支
export type RecurringType = 'PERIODIC' | 'LOAN';

export interface RecurringTransaction {
  id: string;
  name: string;
  type: RecordType;
  recurringType: RecurringType;
  amount: number;
  accountId: string;
  accountName: string;
  toAccountId?: string;
  categoryCode?: string;
  categoryName?: string;
  payer?: string;
  remark?: string;
  cron: string; // '0 0 5 * *' 简化为周期描述
  active: boolean;
  nextGenerateAt?: string;
}

// 用户管理
export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

// AI 审计日志
export type AuditAction = 'tool_call' | 'confirm' | 'reject' | 'model_call';

export interface AuditLogItem {
  id: string;
  userNickname: string;
  action: AuditAction;
  toolName?: string;
  input?: string; // JSON 字符串
  output?: string; // JSON 字符串
  modelName?: string;
  durationMs?: number;
  status: 'success' | 'error';
  errorMessage?: string;
  createdAt: string;
}