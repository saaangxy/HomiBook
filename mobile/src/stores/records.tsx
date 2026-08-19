import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { mockRecords } from '@/mock/data';
import type { RecordItem } from '@/types';

interface RecordsValue {
  records: RecordItem[];
  addRecord: (r: Omit<RecordItem, 'id'>) => void;
}

const RecordsContext = createContext<RecordsValue | null>(null);

// 流水数据源:初始化于 mock,「记一笔」保存后即时生效(首页最近流水同步)
export function RecordsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<RecordItem[]>(mockRecords);

  const value = useMemo<RecordsValue>(
    () => ({
      records,
      addRecord: (r) => setRecords((prev) => [{ ...r, id: `r${Date.now()}` }, ...prev]),
    }),
    [records],
  );

  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>;
}

export function useRecords() {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error('useRecords must be used within RecordsProvider');
  return ctx;
}