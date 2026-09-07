import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRecord, deleteRecordApi, fetchAccounts, fetchCategories, fetchRecords, updateRecordApi, type RecordCreatePayload } from '@/services/records';
import { useLedgerStore } from '@/stores/ledger';
import type { AccountItem, Category, RecordItem, RecordSummary } from '@/types';

interface RecordsValue {
  records: RecordItem[];
  /** 由 records 派生(收入/支出/转账/净收入),与列表永远一致 */
  summary: RecordSummary;
  accounts: AccountItem[];
  categories: Category[];
  loading: boolean;
  refresh: () => Promise<void>;
  addRecord: (r: Omit<RecordItem, 'id'>) => Promise<void>;
  updateRecord: (id: string, patch: Partial<Omit<RecordItem, 'id'>>) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
  cloneRecord: (r: RecordItem) => Promise<void>;
}

const RecordsContext = createContext<RecordsValue | null>(null);

// mobile 扁平展示类型 -> 后端创建/更新记录 payload
function toCreatePayload(r: Partial<Omit<RecordItem, 'id'>> & { attachmentIds?: string[] }, accountBookId: string): RecordCreatePayload {
  return {
    accountBookId,
    type: r.type ?? 'EXPENSE',
    amount: r.amount ?? 0,
    date: r.date ?? '',
    remark: r.remark ?? null,
    tags: r.tags ?? [],
    accountId: r.accountId ?? '',
    fromAccountId: r.type === 'TRANSFER' ? r.accountId ?? undefined : undefined,
    toAccountId: r.toAccountId ?? undefined,
    categoryCode: r.categoryCode ?? null,
    payer: r.counterparty ?? null,
    ...(r.attachmentIds ? { attachmentIds: r.attachmentIds } : {}),
  };
}

// 流水唯一数据源:全部页面消费此 store —— 记一笔/编辑/删除后,首页/流水/日历/统计即时一致
export function RecordsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  // 以当前账本为数据维度;无账本(未登录/未加载)时不请求
  const { currentLedger } = useLedgerStore();
  const bookId = currentLedger.id;

  const refresh = useCallback(async () => {
    if (!bookId) {
      setRecords([]);
      setAccounts([]);
      setLoading(false);
      return;
    }
    const [r, a, c] = await Promise.all([fetchRecords(bookId), fetchAccounts(bookId), fetchCategories()]);
    setRecords(r);
    setAccounts(a);
    setCategories(c);
    setLoading(false);
  }, [bookId]);

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
      addRecord: async (r) => {
        if (!bookId) return;
        await createRecord(bookId, toCreatePayload(r, bookId));
        await refresh();
      },
      updateRecord: async (id, patch) => {
        if (!bookId) return;
        await updateRecordApi(bookId, id, toCreatePayload(patch, bookId));
        await refresh();
      },
      deleteRecord: async (id) => {
        if (!bookId) return;
        await deleteRecordApi(bookId, id);
        await refresh();
      },
      cloneRecord: async (r) => {
        if (!bookId) return;
        await createRecord(bookId, toCreatePayload(r, bookId));
        await refresh();
      },
    }),
    [records, summary, accounts, categories, loading, refresh, bookId],
  );

  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>;
}

export function useRecords() {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error('useRecords must be used within RecordsProvider');
  return ctx;
}
