// 领域类型。
// 无冲突类型已迁移至 @homibook/core 并在此 re-export;
// 冲突/特有类型(RecordItem 扁平展示型、AccountItem、BudgetItem、RecurringTransaction、Ledger、Server、RadarMetric)保留本地,
// 后续对接后端时以 core 权威类型为准逐步收敛。

// ── 从 @homibook/core re-export 的无冲突类型 ──
export type {
  RecordType,
  RecordSummary,
  RecordListResult,
  RecordFilter,
  RecordCalendarDay,
  MonthlyTrendPoint,
  CategorySummary,
  Category,
  AccountType,
  BalanceAdjustment,
  BudgetType,
  RecurringType,
  LoanInterestMethod,
  RepaymentPlan,
  LoanPreview,
  UserInfo,
  UserRole,
  UserStatus,
  BookItem,
  BookDetail,
  BookMember,
  BookRole,
  ShareCode,
} from '@homibook/core';
export { ACCOUNT_TYPE_LABELS } from '@homibook/core';

// ── 本地保留:后台用户管理(mobile 简化版,字段非空) ──
import type { UserRole as _UR, UserStatus as _US } from '@homibook/core';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  nickname: string;
  role: _UR;
  status: _US;
  createdAt: string;
}

// ── 本地保留:流水(扁平展示型,后续对齐 core 权威 RecordItem) ──
import type { RecordType as _RecordType } from '@homibook/core';

export interface RecordItem {
  id: string;
  type: _RecordType;
  amount: number;
  date: string;
  remark: string | null;
  categoryCode: string | null;
  categoryName?: string;
  accountId: string;
  accountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  counterparty?: string;
  ownerId?: string;
  ownerName?: string;
  tags: string[];
  /** 流水附件(小票/发票等),url 为相对路径 */
  attachments?: { id: string; url: string; originalFilename: string }[];
}

// ── 本地保留:账户 ──
import type { AccountType as _AccountType } from '@homibook/core';

export interface AccountItem {
  id: string;
  name: string;
  type: _AccountType;
  balance: number;
  initialBalance: number;
  bankName: string | null;
  accountNo?: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

// ── 本地保留:预算(month 可 null;FREE 带标签与统计区间) ──
import type { BudgetType as _BudgetType } from '@homibook/core';

export interface BudgetItem {
  id: string;
  name: string;
  type: _BudgetType;
  categoryCode: string | null;
  amount: number;
  actualAmount: number;
  year: number;
  month: number | null;
  tags: string[];
  startDate: string | null;
  endDate: string | null;
  remark: string | null;
}

// ── 本地保留:固定收支 ──
import type { RecordType as _RT, RecurringType as _RecT, LoanInterestMethod as _LIM } from '@homibook/core';

export interface RecurringTransaction {
  id: string;
  name: string;
  type: _RT;
  recurringType: _RecT;
  amount: number;
  accountId: string;
  accountName: string;
  toAccountId?: string;
  toAccountName?: string;
  categoryCode?: string;
  categoryName?: string;
  payer?: string;
  remark?: string;
  tags: string[];
  cron: string; // '0 0 5 * *' 简化为周期描述
  active: boolean;
  nextGenerateAt?: string;
  // 贷款类型字段
  loanTotalAmount?: number | null;
  loanRemainingAmount?: number | null;
  loanInterestRate?: number | null;
  loanInterestMethod?: _LIM | null;
  loanStartDate?: string | null;
  loanTermMonths?: number | null;
}

// ── 本地保留:账本(mobile 使用 Ledger 命名) ──
export interface Ledger {
  id: string;
  name: string;
  icon: string; // emoji
  memberCount: number;
  shareCode?: string;
  role?: 'OWNER' | 'MEMBER';
}

export interface LedgerMember {
  id: string;
  /** 成员对应的用户 id(归属人 ownerId 用) */
  userId?: string;
  nickname: string;
  role: 'OWNER' | 'MEMBER';
  joinedAt: string;
}

export interface ShareCodeItem {
  id: string;
  code: string;
  expiresAt: string | null;
  createdAt: string;
}

export type LedgerMenu = {
  icon: string;
  label: string;
  to?: string;
};

// ── 本地保留:雷达指标(统计页专用) ──
export interface RadarMetric {
  name: string;
  value: number;
  detail?: string;
  available?: boolean;
}

// ── 本地保留:自部署服务器配置(地址/账号/密码/API Key 一体管理) ──
export interface Server {
  id: string;
  name: string;
  baseUrl: string;
  /** 登录账号 */
  account?: string;
  /** 账号密码(可选,选择服务器后可一键登录) */
  password?: string;
  /** API Key(可选,作为密码之外的另一种登录凭证) */
  apiKey?: string;
}
