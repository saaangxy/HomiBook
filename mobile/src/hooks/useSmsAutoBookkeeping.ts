import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { showToast } from '@/components/chrome/Toast';
import { notifyPageRefresh, useUIShell } from '@/components/chrome/chrome';
import { useAuth } from '@/stores/auth';
import { AUTO_MIN_INTERVAL_MS, runAutoBookkeeping } from '@/services/sms-auto';
import { postBookkeepingNotifications } from '@/services/notifications';

// 自动记账的触发点:启动 + 每次回到前台(按 AUTO_MIN_INTERVAL_MS 节流)。
// Android 后台限制下拿不到「短信到达」的即时回调,这里用前台补扫兜底;
// 真实到达时刻与延迟边界见 example/图片分享与短信记账方案.md 的风险表。
// 失败一律静默 —— 自动记账是锦上添花,任何异常都不该打扰用户(手动扫描始终可用)。

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

    const run = () => {
      if (runningRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < AUTO_MIN_INTERVAL_MS) return;
      runningRef.current = true;
      lastRunRef.current = now;
      void (async () => {
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
        } catch {
          // 静默:网络/权限等问题下自动记账不打扰用户
        } finally {
          runningRef.current = false;
        }
      })();
    };

    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [isLoggedIn, bookId]);
}

/** 自动记账桥接:挂在 UIShellProvider 内层,自身不渲染任何内容 */
export function SmsAutoBookkeepingBridge() {
  useSmsAutoBookkeeping();
  return null;
}
