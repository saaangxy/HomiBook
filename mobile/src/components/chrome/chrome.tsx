import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Ledger, RecordItem } from '@/types';
import { createBookApi, fetchBooks } from '@/services/records';
import { secureGet, secureSet } from '@/services/storage';
import { useAuth } from '@/stores/auth';

// 记住每个服务器+账号最后使用的账本:key 按服务器 baseUrl 与账号区分(避免跨账号串用无权账本)
const ledgerKey = (baseUrl: string, account: string) => `homibook.ledger.${baseUrl}.${account || 'default'}`;

interface UIShellValue {
  // 账本
  ledgers: Ledger[];
  currentLedger: Ledger;
  switchLedger: (id: string) => void;
  createLedger: (name: string) => void;
  /** 重新拉取账本列表并保留当前选择(加入/退出账本后调用) */
  refreshLedgers: () => Promise<void>;
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
  /** AI 财务助手弹窗 */
  aiOpen: boolean;
  openAI: () => void;
  closeAI: () => void;
}

const UIShellContext = createContext<UIShellValue | null>(null);

export function UIShellProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, currentServer, username } = useAuth();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [currentLedgerId, setCurrentLedgerId] = useState('');
  const baseUrl = currentServer?.baseUrl ?? '';
  const account = username || 'default';

  // 保存当前服务器+账号选中的账本
  const saveLedgerId = (id: string) => {
    if (baseUrl && id) secureSet(ledgerKey(baseUrl, account), id);
  };

  // 登出/切换账号时清空账本,避免残留旧账号的账本 id 导致无权访问
  useEffect(() => {
    if (!isLoggedIn) {
      setLedgers([]);
      setCurrentLedgerId('');
    }
  }, [isLoggedIn]);

  // 登录后拉取账本,优先打开该服务器+账号上次使用的账本,否则选第一个
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    // 服务器切换(或账号变更)时先清空,避免用旧服务器的账本 id 请求新服务器
    setLedgers([]);
    setCurrentLedgerId('');
    fetchBooks()
      .then(async (books) => {
        if (cancelled) return;
        // 空账本也要正常落地(列表为空、无当前账本)
        setLedgers(books);
        if (books.length === 0) {
          setCurrentLedgerId('');
          return;
        }
        const remembered = baseUrl ? await secureGet(ledgerKey(baseUrl, account)).catch(() => null) : null;
        const rememberedId = remembered && books.some((b) => b.id === remembered) ? remembered : '';
        const finalId = rememberedId || books[0].id;
        setCurrentLedgerId(finalId);
        // 选中后立即保存,切走再切回能恢复该账本
        saveLedgerId(finalId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, baseUrl, account]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const value = useMemo<UIShellValue>(
    () => ({
      ledgers,
      currentLedger: ledgers.find((l) => l.id === currentLedgerId) ?? ledgers[0] ?? { id: '', name: '', icon: '📒', memberCount: 0 },
      switchLedger: (id) => {
        setCurrentLedgerId(id);
        saveLedgerId(id);
        setLedgerOpen(false);
      },
      createLedger: async (name) => {
        await createBookApi(name);
        setLedgerOpen(false);
        const books = await fetchBooks().catch(() => []);
        if (books.length > 0) {
          setLedgers(books);
          setCurrentLedgerId(books[books.length - 1].id);
          saveLedgerId(books[books.length - 1].id);
        }
      },
      refreshLedgers: async () => {
        const books = await fetchBooks().catch(() => []);
        setLedgers(books);
        if (books.length > 0) {
          setCurrentLedgerId((prev) => (books.some((b) => b.id === prev) ? prev : books[0].id));
        } else {
          setCurrentLedgerId('');
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
      aiOpen,
      openAI: () => {
        setSidebarOpen(false);
        setAiOpen(true);
      },
      closeAI: () => setAiOpen(false),
    }),
    [ledgers, currentLedgerId, sidebarOpen, ledgerOpen, recordOpen, editingRecord, aiOpen, baseUrl, account],
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