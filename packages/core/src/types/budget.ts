/** 预算领域类型(权威,以后端响应为准) */

export type BudgetType = 'FIXED' | 'FREE';

/** 预算类型全集(运行时校验用,与 BudgetType 联合保持一致) */
export const BUDGET_TYPES = ['FIXED', 'FREE'] as const;

/**
 * 预算类型中文标签(单一来源,各端勿再各写一份)。
 * FIXED=月度预算(按自然月统计);FREE=项目预算(按标签匹配,可带起止日期,不限于单月)。
 * 底层值保持 FIXED/FREE 不变,避免历史数据与接口迁移。
 */
export const BUDGET_TYPE_LABELS: Record<BudgetType, string> = {
  FIXED: '月度',
  FREE: '项目',
};

/** 预算维度标签(筛选、列表、维度汇总共用) */
export const BUDGET_DIMENSION_LABELS = {
  category: '分类',
  project: '标签',
  member: '成员',
} as const;

/** 是否为合法预算类型(历史数据/外部写入可能存在非法值) */
export function isBudgetType(value: unknown): value is BudgetType {
  return typeof value === 'string' && (BUDGET_TYPES as readonly string[]).includes(value);
}

/**
 * 预算类型归一化:非法值回落 FREE。
 * 各端渲染都用 `type === 'FIXED' ? 月度 : 项目` 的分支,而列表查询按 type 过滤,
 * 非法值既显示为「项目预算」又查不出来,故归一为 FREE 与展示口径一致。
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
  month: number | null; // 项目预算为 null
  amount: number;
  categoryCode: string | null;
  tags: string[];
  /** 家庭成员维度：流水归属人(User.id) */
  ownerId: string | null;
  /** 归属人展示名(昵称/邮箱),由后端返回 */
  ownerName: string | null;
  startDate: string | null;
  endDate: string | null;
  remark: string | null;
  actualAmount: number;
  createdAt: string;
  updatedAt: string;
}
