import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { showToast } from '@/components/chrome/Toast';
import { notifyPageRefresh, useUIShell } from '@/components/chrome/chrome';
import { useAuth } from '@/stores/auth';
import { AUTO_MIN_INTERVAL_MS, runAutoBookkeeping } from '@/services/sms-auto';
import { postBookkeepingNotifications } from '@/services/notifications';
import { acquireAutoBookLock, loadAutoBookLastRun, markAutoBookRan, releaseAutoBookLock } from '@/services/auto-book-keys';

// 自动记账的触发点:启动 + 每次回到前台(按 AUTO_MIN_INTERVAL_MS 节流)。
// Android 后台限制下拿不到「短信到达」的即时回调,这里用前台补扫兜底;
// 真实到达时刻与延迟边界见 example/图片分享与短信记账方案.md 的风险表。
// 失败一律静默 —— 自动记账是锦上添花,任何异常都不该打扰用户(手动扫描始终可用)。

/** 临时调试日志(仅开发版):排查「为什么这次没有自动记账」 */
function logAutoHook(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[自动记账·触发]', ...args);
}

export function useSmsAutoBookkeeping() {
  const { isLoggedIn } = useAuth();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  // 上次执行时刻:切前台很频繁,节流后不再重复打服务器
  const lastRunRef = useRef(0);
  // 执行互斥:启动与 AppState 变化可能同帧触发
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn || !bookId) return;

    // 继承后台最近一次执行时刻:后台已按通知入过账,回前台不必立刻重扫。
    // 后台是独立 JS 上下文,靠持久化时间戳与这里对齐(见 services/auto-book-keys)
    void loadAutoBookLastRun().then((at) => {
      if (at > lastRunRef.current) lastRunRef.current = at;
    });

    const run = () => {
      if (runningRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < AUTO_MIN_INTERVAL_MS) return;
      runningRef.current = true;
      lastRunRef.current = now;
      // 同步给后台任务:避免「前台刚开始扫,通知到达又拉一起扫」的并发
      void markAutoBookRan(now);
      void (async () => {
        // 与后台共用一把锁:通知恰好在这次扫描期间到达时,后到的一方让位,
        // 否则两边会同时读到「未处理」并提交同一笔(服务端虽会拦,但会多出一条疑似重复)
        if (!(await acquireAutoBookLock())) {
          runningRef.current = false;
          return;
        }
        try {
          const res = await runAutoBookkeeping(bookId);
          if (res.imported > 0) {
            notifyPageRefresh();
            const msg = `已入账 ${res.imported} 笔${res.pending > 0 ? `,另有 ${res.pending} 笔待确认` : ''}`;
            // 系统通知(托盘留一份,点它直接跳到对应流水)+ 应用内 toast;
            // 「入账后发送通知」关掉时只留 toast(见设置页开关)
            if (res.notify !== false) {
              void postBookkeepingNotifications(res.items ?? []);
            }
            showToast(msg);
          }
        } catch (e) {
          // 静默:网络/权限等问题下自动记账不打扰用户(仅开发版留日志)
          logAutoHook('异常', e instanceof Error ? e.message : String(e));
        } finally {
          await releaseAutoBookLock();
          runningRef.current = false;
        }
      })();
    };

    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      run();
    });
    return () => sub.remove();
  }, [isLoggedIn, bookId]);
}

/** 自动记账桥接:挂在 UIShellProvider 内层,自身不渲染任何内容 */
export function SmsAutoBookkeepingBridge() {
  useSmsAutoBookkeeping();
  return null;
}
