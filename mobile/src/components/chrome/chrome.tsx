import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useIsFocused } from 'expo-router';
import type { RecordItem } from '@/types';
import { useLedgerStore } from '@/stores/ledger';

// UI 壳层:抽屉/弹窗开关(账本数据在 stores/ledger.tsx,这里转发以保持 useUIShell() 接口不变)

interface UIShellValue {
  // 账本(转发自 ledger store)
  ledgers: ReturnType<typeof useLedgerStore>['ledgers'];
  currentLedger: ReturnType<typeof useLedgerStore>['currentLedger'];
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

/** context 瞬态不可用时的安全空实现(见 useUIShell 注释) */
const UISHELL_FALLBACK: UIShellValue = {
  ledgers: [],
  currentLedger: { id: '', name: '', icon: '📒', memberCount: 0 },
  switchLedger: () => {},
  createLedger: () => {},
  refreshLedgers: async () => {},
  sidebarOpen: false,
  openSidebar: () => {},
  closeSidebar: () => {},
  ledgerOpen: false,
  openLedger: () => {},
  closeLedger: () => {},
  recordOpen: false,
  openRecord: () => {},
  closeRecord: () => {},
  editingRecord: null,
  aiOpen: false,
  openAI: () => {},
  closeAI: () => {},
};

export function UIShellProvider({ children }: { children: ReactNode }) {
  // 账本数据来自 ledger store(本组件只做转发,弹窗开关在下方自持)
  const ledger = useLedgerStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const value = useMemo<UIShellValue>(
    () => ({
      ledgers: ledger.ledgers,
      currentLedger: ledger.currentLedger,
      switchLedger: (id) => {
        ledger.switchLedger(id);
        setLedgerOpen(false);
      },
      createLedger: async (name) => {
        await ledger.createLedger(name);
        setLedgerOpen(false);
      },
      refreshLedgers: ledger.refreshLedgers,
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
    [ledger, sidebarOpen, ledgerOpen, recordOpen, editingRecord, aiOpen],
  );

  return (
    <UIShellContext.Provider value={value}>
      {children}
    </UIShellContext.Provider>
  );
}

export function useUIShell() {
  const ctx = useContext(UIShellContext);
  if (!ctx) {
    // 瞬态兜底:freezeOnBlur 冻结子树/热更新等场景下,context 可能在一个渲染周期内短暂不可达
    // (表现为 setLedgers 等状态更新触发的重渲染抛「useUIShell must be used within UIShellProvider」)。
    // 根布局的 Provider 接线是静态保证的,这里返回安全空实现避免瞬态崩溃;开发环境给出警告便于定位。
    if (__DEV__) console.warn('useUIShell: context 暂不可用(瞬态),已回退到空实现');
    return UISHELL_FALLBACK;
  }
  return ctx;
}

// ── 页面刷新注册:编辑/记一笔保存成功后直接刷新发起页 ──
// 页面在前台时注册自己的刷新方法(离开自动注销),RecordModal 保存成功后由 notifyPageRefresh()
// 触发当前前台页面刷新 —— 只有发起页响应,不广播,避免后台页并发请求。

let pageRefreshFn: (() => void) | null = null;

/** 页面刷新注册 hook:fn 引用始终取最新闭包,调用时无需担心依赖过期 */
export function usePageRefresh(refresh: () => void) {
  const isFocused = useIsFocused();
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    if (!isFocused) return;
    pageRefreshFn = () => ref.current();
    return () => {
      pageRefreshFn = null;
    };
  }, [isFocused]);
}

/** 通知当前前台页面刷新数据(无注册页面时为空操作) */
export function notifyPageRefresh() {
  pageRefreshFn?.();
}
