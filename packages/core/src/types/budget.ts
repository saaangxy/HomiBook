/** 预算领域类型(权威,以后端响应为准) */

export type BudgetType = 'FIXED' | 'FREE';

export interface BudgetItem {
  id: string;
  accountBookId: string;
  name: string;
  type: BudgetType;
  year: number;
  month: number | null; // 年度预算(自由)为 null
  amount: number;
  categoryCode: string | null;
  tags: string[];
  startDate: string | null;
  endDate: string | null;
  remark: string | null;
  actualAmount: number;
  createdAt: string;
  updatedAt: string;
}
