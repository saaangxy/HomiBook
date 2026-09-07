import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Ledger } from '@/types';
import { createBookApi, fetchBooks } from '@/services/records';
import { secureGet, secureSet } from '@/services/storage';
import { useAuth } from '@/stores/auth';

// 账本域 store:当前账本 / 账本列表 / 切换与刷新的唯一数据源。
// chrome(UIShellProvider)转发本 store 供既有 useUIShell() 消费者使用;
// 数据层(stores/records 等)直接依赖本 store,避免状态层反向依赖 UI 壳层。

// 记住每个服务器+账号最后使用的账本:key 按服务器 baseUrl 与账号区分(避免跨账号串用无权账本)
const ledgerKey = (baseUrl: string, account: string) => `homibook.ledger.${baseUrl}.${account || 'default'}`;

const EMPTY_LEDGER: Ledger = { id: '', name: '', icon: '📒', memberCount: 0 };

interface LedgerStoreValue {
  ledgers: Ledger[];
  currentLedger: Ledger;
  switchLedger: (id: string) => void;
  createLedger: (name: string) => Promise<void>;
  /** 重新拉取账本列表并保留当前选择(加入/退出账本后调用) */
  refreshLedgers: () => Promise<void>;
}

const LedgerStoreContext = createContext<LedgerStoreValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, baseUrl, account]);

  const value = useMemo<LedgerStoreValue>(
    () => ({
      ledgers,
      currentLedger: ledgers.find((l) => l.id === currentLedgerId) ?? ledgers[0] ?? EMPTY_LEDGER,
      switchLedger: (id) => {
        setCurrentLedgerId(id);
        saveLedgerId(id);
      },
      createLedger: async (name) => {
        await createBookApi(name);
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
    }),
    [ledgers, currentLedgerId, baseUrl, account],
  );

  return <LedgerStoreContext.Provider value={value}>{children}</LedgerStoreContext.Provider>;
}

export function useLedgerStore() {
  const ctx = useContext(LedgerStoreContext);
  if (!ctx) throw new Error('useLedgerStore must be used within LedgerProvider');
  return ctx;
}
