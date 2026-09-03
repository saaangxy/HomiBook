/**
 * 全局错误兜底:在根布局 import 本模块即生效(副作用)。
 * - 未处理 Promise rejection:RN 默认只打印 ERROR 日志,用户无感知 → 接管为分级提示
 * - 致命 JS 异常(isFatal):默认红屏(dev)/闪退(prod) → 弹窗提供「重新加载」
 * - 网络/连接类错误:轻提示(3s 节流,并发请求同时失败不刷屏)
 */
import { Alert } from 'react-native';
import { showToast } from '@/components/chrome/Toast';

// ── 提示节流:并发请求同时失败时避免连续刷提示 ──
let lastMsg = '';
let lastAt = 0;
export function notifyErrorOnce(message: string): void {
  const now = Date.now();
  if (message === lastMsg && now - lastAt < 3000) return;
  lastMsg = message;
  lastAt = now;
  showToast(message);
}

function isNetworkLike(error?: unknown): boolean {
  // 网络连接类:由 http 层包装的 ApiError(不 import 避免循环依赖,按消息特征判断)
  if (error instanceof Error) {
    return error.message.includes('无法连接服务器') || error.message.includes('连接超时');
  }
  return false;
}

function reportError(error?: unknown): void {
  if (isNetworkLike(error)) {
    notifyErrorOnce('网络异常,请检查网络后重试');
    return;
  }
  const msg = error instanceof Error ? error.message : String(error ?? '未知错误');
  notifyErrorOnce(`操作异常: ${msg.slice(0, 60)}`);
}

// ── 未处理 Promise rejection:接管 RN promise polyfill 的 rejection tracking ──
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rejectionTracking = require('promise/setimmediate/rejection-tracking');
  rejectionTracking.enable({
    allRejections: false,
    onUnhandled: (_id: number, error?: Error) => {
      console.error('[Unhandled rejection]', error ?? '(unknown)');
      reportError(error);
    },
  });
} catch {
  // 环境不支持 polyfill tracking(原生 Promise 实现)时忽略
}

// ── 致命 JS 异常(ErrorUtils 全局 handler) ──
try {
  const originalHandler = ErrorUtils.getGlobalHandler?.();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[Global error]', isFatal ? 'fatal' : 'non-fatal', error);
    if (!isFatal) {
      reportError(error);
      return;
    }
    // 致命异常:弹窗引导重启(默认行为是红屏/闪退,这里维持应用可用)
    Alert.alert(
      '应用出现异常',
      `${error?.message ?? '未知错误'}\n\n建议重启应用后重试;若持续出现请反馈问题。`,
      [{ text: '知道了', style: 'cancel' }],
    );
    // 开发环境保留默认红屏便于定位堆栈;生产吞掉避免闪退
    if (__DEV__) originalHandler?.(error, isFatal);
  });
} catch {
  // ErrorUtils 不可用(极旧环境)时忽略
}
