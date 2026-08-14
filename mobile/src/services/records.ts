import { mockAccounts, mockBudgets, mockCategories, mockMonthlyTrend, mockRadar, mockRecords, mockSummary } from '@/mock/data';
import type { AccountItem, BudgetItem, Category, RadarMetric, RecordItem, RecordSummary } from '@/types';

// 数据访问层:当前全部返回 mock,后续替换为真实 API 调用时仅改这里,页面零改动

export function fetchRecords(): Promise<RecordItem[]> {
  return Promise.resolve([...mockRecords].sort((a, b) => b.date.localeCompare(a.date)));
}

export function fetchSummary(): Promise<RecordSummary> {
  return Promise.resolve({ ...mockSummary });
}

export function fetchAccounts(): Promise<AccountItem[]> {
  return Promise.resolve(mockAccounts);
}

export function fetchBudgets(): Promise<BudgetItem[]> {
  return Promise.resolve(mockBudgets);
}

export function fetchCategories(): Promise<Category[]> {
  return Promise.resolve(mockCategories);
}

export function fetchRadar(): Promise<RadarMetric[]> {
  return Promise.resolve(mockRadar);
}

export function fetchMonthlyTrend() {
  return Promise.resolve(mockMonthlyTrend);
}