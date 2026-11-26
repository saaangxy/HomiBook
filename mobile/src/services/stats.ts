import type { RecordSummary } from '@/types';
import { fetchSummary } from './records';

/** 统计口径的日期区间(两端含,YYYY-MM-DD) */
export interface StatsDateRange {
  dateFrom: string;
  dateTo: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 统计页与首页共用的期间划分:
 * 原先首页自己按月/年拼区间、年卡片还直接累加月度趋势(实际是全量),
 * 与统计页口径不一致。这里统一出口,避免边界与范围漂移。
 */
export function monthDateRange(year: number, month: number): StatsDateRange {
  return {
    dateFrom: `${year}-${pad2(month)}-01`,
    dateTo: `${year}-${pad2(month)}-${new Date(year, month, 0).getDate()}`,
  };
}

export function yearDateRange(year: number): StatsDateRange {
  return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
}

export function currentMonthDateRange(): StatsDateRange {
  const now = new Date();
  return monthDateRange(now.getFullYear(), now.getMonth() + 1);
}

export function currentYearDateRange(): StatsDateRange {
  return yearDateRange(new Date().getFullYear());
}

/** 统一汇总查询:按统计口径的区间从后端聚合,首页与统计页共用 */
export function fetchPeriodSummary(
  bookId: string,
  range: StatsDateRange,
  opts?: { accountId?: string; ownerId?: string },
): Promise<RecordSummary> {
  return fetchSummary(bookId, { ...range, ...opts });
}
