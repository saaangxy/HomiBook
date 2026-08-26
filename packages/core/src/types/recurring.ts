/** 固定收支领域类型(权威,以后端响应为准) */

export type RecurringType = 'PERIODIC' | 'LOAN';
export type LoanInterestMethod = 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL';

export interface RecurringTransaction {
  id: string;
  accountBookId: string;
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
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
  status: 'PENDING' | 'GENERATED';
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
