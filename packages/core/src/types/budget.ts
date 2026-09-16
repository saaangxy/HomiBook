/** 预算领域类型(权威,以后端响应为准) */

export type BudgetType = 'FIXED' | 'FREE';

/** 预算类型全集(运行时校验用,与 BudgetType 联合保持一致) */
export const BUDGET_TYPES = ['FIXED', 'FREE'] as const;

/**
 * 预算类型中文标签(单一来源,各端勿再各写一份)。
 * FIXED=月度固定预算、FREE=自由预算(可按标签/日期区间匹配,不限于单月),
 * 故此处用「固定/自由」而不是「固定/月度」——后者与 FREE 的语义不符。
 */
export const BUDGET_TYPE_LABELS: Record<BudgetType, string> = {
  FIXED: '固定',
  FREE: '自由',
};

/** 是否为合法预算类型(历史数据/外部写入可能存在非法值) */
export function isBudgetType(value: unknown): value is BudgetType {
  return typeof value === 'string' && (BUDGET_TYPES as readonly string[]).includes(value);
}

/**
 * 预算类型归一化:非法值回落 FREE。
 * 各端渲染都用 `type === 'FIXED' ? 固定 : 自由` 的分支,而列表查询按 type 过滤,
 * 非法值既显示为「自由预算」又查不出来,故归一为 FREE 与展示口径一致。
 */
export function normalizeBudgetType(value: unknown): BudgetType {
  return isBudgetType(value) ? value : 'FREE';
}

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
