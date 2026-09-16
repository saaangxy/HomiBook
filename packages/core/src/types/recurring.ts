/** 固定收支领域类型(权威,以后端响应为准) */
import type { RecordType } from './record.js';

export type RecurringType = 'PERIODIC' | 'LOAN';

/** 固定收支类型全集(运行时校验用) */
export const RECURRING_TYPES = ['PERIODIC', 'LOAN'] as const;

/** 固定收支类型中文标签(PERIODIC 统一为「周期」,后端预览卡曾写作「定期」) */
export const RECURRING_TYPE_LABELS: Record<RecurringType, string> = {
  PERIODIC: '周期',
  LOAN: '贷款',
};

export type LoanInterestMethod = 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL';

/** 贷款计息方式全集(运行时校验用) */
export const LOAN_INTEREST_METHODS = ['EQUAL_INSTALLMENT', 'EQUAL_PRINCIPAL'] as const;

export const LOAN_INTEREST_METHOD_LABELS: Record<LoanInterestMethod, string> = {
  EQUAL_INSTALLMENT: '等额本息',
  EQUAL_PRINCIPAL: '等额本金',
};

export type RepaymentPlanStatus = 'PENDING' | 'GENERATED';

/** 还款计划状态全集 */
export const REPAYMENT_PLAN_STATUSES = ['PENDING', 'GENERATED'] as const;

export const REPAYMENT_PLAN_STATUS_LABELS: Record<RepaymentPlanStatus, string> = {
  PENDING: '待还款',
  GENERATED: '已生成',
};

export interface RecurringTransaction {
  id: string;
  accountBookId: string;
  name: string;
  type: RecordType;
  amount: number;
  remark: string | null;
  tags: string[];
  accountId: string;
  account: { id: string; name: string; type: string };
  toAccountId: string | null;
  toAccount: { id: string; name: string; type: string } | null;
  categoryCode: string | null;
  payer: string | null;
  ownerId: string;
  owner: { id: string; name: string; email: string } | null;
  cron: string;
  active: boolean;
  recurringType: RecurringType;
  loanTotalAmount: number | null;
  loanRemainingAmount: number | null;
  loanInterestRate: number | null;
  loanInterestMethod: LoanInterestMethod | null;
  loanStartDate: string | null;
  loanTermMonths: number | null;
  loanMonthlyPayment: number | null;
  lastGeneratedAt: string | null;
  nextGenerateAt: string | null;
  createdAt: string;
  updatedAt: string;
  repaymentPlans?: RepaymentPlan[];
  // mobile 展示派生字段(可选)
  accountName?: string;
  toAccountName?: string;
  categoryName?: string;
  /** 周期描述(mobile 将 cron 简化展示) */
  cronDescription?: string;
}

export interface RepaymentPlan {
  id: string;
  recurringTransactionId: string;
  period: number;
  dueDate: string;
  totalPayment: number;
  principal: number;
  interest: number;
  remainingPrincipal: number;
  status: RepaymentPlanStatus;
  generatedRecordId: string | null;
}

export interface LoanPreview {
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  plan: Array<{
    period: number;
    dueDate: string;
    totalPayment: number;
    principal: number;
    interest: number;
    remainingPrincipal: number;
  }>;
}
