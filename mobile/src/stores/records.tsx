import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRecord, deleteRecordApi, fetchAccounts, fetchCategories, fetchRecords, fetchSummary, updateRecordApi, type RecordCreatePayload } from '@/services/records';
import { useLedgerStore } from '@/stores/ledger';
import { registerAccountCache } from '@/stores/account-cache';
import type { AccountItem, Category, RecordItem, RecordSummary } from '@/types';

interface RecordsValue {
  records: RecordItem[];
  /**
   * 全量汇总(收入/支出/转账/净收入):来自后端 /summary 聚合,与分页列表无关。
   * 净收入 = 收入 − 支出(转账不计入收支,单列)。
   */
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
  /** 全量汇总:后端聚合,不再由客户端对列表求和(那会受分页上限影响) */
  const [summary, setSummary] = useState<RecordSummary>({ income: 0, expense: 0, transfer: 0, netIncome: 0 });
  // 以当前账本为数据维度;无账本(未登录/未加载)时不请求
  const { currentLedger } = useLedgerStore();
  const bookId = currentLedger.id;

  const refresh = useCallback(async () => {
    if (!bookId) {
      // 无账本(未登录/正在切换账号):把上一个账号的数据清干净,避免切换瞬间看到旧流水
      setRecords([]);
      setAccounts([]);
      setCategories([]);
      setSummary({ income: 0, expense: 0, transfer: 0, netIncome: 0 });
      setLoading(false);
      return;
    }
    // 汇总由后端聚合:原先是客户端对 fetchRecords 的结果求和,而它默认 pageSize=100,
    // 流水超过 100 条时只统计最近 100 条 —— 与首页/统计页的后端口径必然对不上。
    const [r, a, c, s] = await Promise.all([
      fetchRecords(bookId), fetchAccounts(bookId), fetchCategories(), fetchSummary(bookId),
    ]);
    setRecords(r);
    setAccounts(a);
    setCategories(c);
    setSummary(s);
    setLoading(false);
  }, [bookId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 注册到统一的账号缓存清理:登出/切账号时立即清空上一个账号的流水/账户/分类,
  // 不等 bookId 变化再级联(pending 的请求也会被后续 refresh 覆盖)
  useEffect(
    () =>
      registerAccountCache(() => {
        setRecords([]);
        setAccounts([]);
        setCategories([]);
        setLoading(false);
      }),
    [],
  );



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
