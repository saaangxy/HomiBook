import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Ledger, RecordItem } from '@/types';
import { createBookApi, fetchBooks } from '@/services/records';
import { useAuth } from '@/stores/auth';

interface UIShellValue {
  // 账本
  ledgers: Ledger[];
  currentLedger: Ledger;
  switchLedger: (id: string) => void;
  createLedger: (name: string) => void;
  // 抽屉 / 弹窗开关
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  ledgerOpen: boolean;
  openLedger: () => void;
  closeLedger: () => void;
  recordOpen: boolean;
  /** 传入记录即编辑模式,否则新建 */
  openRecord: (record?: RecordItem) => void;
  closeRecord: () => void;
  editingRecord: RecordItem | null;
}

const UIShellContext = createContext<UIShellValue | null>(null);

export function UIShellProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [currentLedgerId, setCurrentLedgerId] = useState('');

  // 登录后拉取后端账本并选中第一个
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchBooks()
      .then((books) => {
        if (books.length === 0) return;
        setLedgers(books);
        setCurrentLedgerId((prev) => (books.some((b) => b.id === prev) ? prev : books[0].id));
      })
      .catch(() => {});
  }, [isLoggedIn]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null);

  const value = useMemo<UIShellValue>(
    () => ({
      ledgers,
      currentLedger: ledgers.find((l) => l.id === currentLedgerId) ?? ledgers[0] ?? { id: '', name: '', icon: '📒', memberCount: 0 },
      switchLedger: (id) => {
        setCurrentLedgerId(id);
        setLedgerOpen(false);
      },
      createLedger: async (name) => {
        await createBookApi(name);
        setLedgerOpen(false);
        const books = await fetchBooks().catch(() => []);
        if (books.length > 0) {
          setLedgers(books);
          setCurrentLedgerId(books[books.length - 1].id);
        }
      },
      sidebarOpen,
      openSidebar: () => setSidebarOpen(true),
      closeSidebar: () => setSidebarOpen(false),
      ledgerOpen,
      openLedger: () => setLedgerOpen(true),
      closeLedger: () => setLedgerOpen(false),
      recordOpen,
      openRecord: (record) => {
        setEditingRecord(record ?? null);
        setRecordOpen(true);
      },
      closeRecord: () => {
        setRecordOpen(false);
        setEditingRecord(null);
      },
      editingRecord,
    }),
    [ledgers, currentLedgerId, sidebarOpen, ledgerOpen, recordOpen, editingRecord],
  );

  return (
    <UIShellContext.Provider value={value}>
      {children}
    </UIShellContext.Provider>
  );
}

export function useUIShell() {
  const ctx = useContext(UIShellContext);
  if (!ctx) throw new Error('useUIShell must be used within UIShellProvider');
  return ctx;
}