import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchAccounts, fetchCategories, fetchRecords } from '@/services/records';
import type { AccountItem, Category, RecordItem, RecordSummary } from '@/types';

interface RecordsValue {
  records: RecordItem[];
  /** 由 records 派生(收入/支出/转账/净收入),与列表永远一致 */
  summary: RecordSummary;
  accounts: AccountItem[];
  categories: Category[];
  loading: boolean;
  refresh: () => Promise<void>;
  addRecord: (r: Omit<RecordItem, 'id'>) => void;
  updateRecord: (id: string, patch: Partial<Omit<RecordItem, 'id'>>) => void;
  deleteRecord: (id: string) => void;
  cloneRecord: (r: RecordItem) => void;
}

const RecordsContext = createContext<RecordsValue | null>(null);

// 流水唯一数据源:全部页面消费此 store —— 记一笔/编辑/删除后,首页/流水/日历/统计即时一致
export function RecordsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [r, a, c] = await Promise.all([fetchRecords(), fetchAccounts(), fetchCategories()]);
    setRecords(r);
    setAccounts(a);
    setCategories(c);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const summary = useMemo<RecordSummary>(() => {
    let income = 0;
    let expense = 0;
    let transfer = 0;
    for (const r of records) {
      if (r.type === 'INCOME') income += r.amount;
      else if (r.type === 'EXPENSE') expense += r.amount;
      else transfer += r.amount;
    }
    return { income, expense, transfer, netIncome: income - expense };
  }, [records]);

  const value = useMemo<RecordsValue>(
    () => ({
      records,
      summary,
      accounts,
      categories,
      loading,
      refresh,
      addRecord: (r) => setRecords((prev) => [{ ...r, id: `r${Date.now()}` }, ...prev]),
      updateRecord: (id, patch) => setRecords((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
      deleteRecord: (id) => setRecords((prev) => prev.filter((x) => x.id !== id)),
      cloneRecord: (r) => setRecords((prev) => [{ ...r, id: `r${Date.now()}` }, ...prev]),
    }),
    [records, summary, accounts, categories, loading, refresh],
  );

  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>;
}

export function useRecords() {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error('useRecords must be used within RecordsProvider');
  return ctx;
}
