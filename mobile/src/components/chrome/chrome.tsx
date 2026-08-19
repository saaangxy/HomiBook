import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Ledger } from '@/types';
import { mockLedgers } from '@/mock/data';
import { Sidebar } from './Sidebar';
import { LedgerModal } from './LedgerModal';
import { RecordModal } from './RecordModal';

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
  openRecord: () => void;
  closeRecord: () => void;
}

const UIShellContext = createContext<UIShellValue | null>(null);

export function UIShellProvider({ children }: { children: ReactNode }) {
  const [ledgers, setLedgers] = useState<Ledger[]>(mockLedgers);
  const [currentLedgerId, setCurrentLedgerId] = useState(mockLedgers[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const value = useMemo<UIShellValue>(
    () => ({
      ledgers,
      currentLedger: ledgers.find((l) => l.id === currentLedgerId) ?? ledgers[0],
      switchLedger: (id) => {
        setCurrentLedgerId(id);
        setLedgerOpen(false);
      },
      createLedger: (name) => {
        setLedgers((prev) => [...prev, { id: `l${Date.now()}`, name, icon: '📒', memberCount: 1 }]);
      },
      sidebarOpen,
      openSidebar: () => setSidebarOpen(true),
      closeSidebar: () => setSidebarOpen(false),
      ledgerOpen,
      openLedger: () => setLedgerOpen(true),
      closeLedger: () => setLedgerOpen(false),
      recordOpen,
      openRecord: () => setRecordOpen(true),
      closeRecord: () => setRecordOpen(false),
    }),
    [ledgers, currentLedgerId, sidebarOpen, ledgerOpen, recordOpen],
  );

  return (
    <UIShellContext.Provider value={value}>
      {children}
      {/* 全局覆盖层:抽屉 / 账本切换 / 记账底部弹窗 */}
      <Sidebar />
      <LedgerModal />
      <RecordModal />
    </UIShellContext.Provider>
  );
}

export function useUIShell() {
  const ctx = useContext(UIShellContext);
  if (!ctx) throw new Error('useUIShell must be used within UIShellProvider');
  return ctx;
}