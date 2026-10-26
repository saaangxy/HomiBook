import { AppRegistry, Platform } from 'react-native';
import { getCurrentServer } from './auth';
import { getCredential } from './http';
import { postBookkeepingNotifications, setupNotifications } from './notifications';
import { loadAutoSettings, runAutoBookkeeping, type AutoRunResult } from './sms-auto';
import { getPendingNotifications } from './txn-reader';
import {
  acquireAutoBookLock,
  loadAutoBookBookId,
  loadAutoBookLastRun,
  markAutoBookRan,
  releaseAutoBookLock,
} from './auto-book-keys';

// 后台自动记账:银行/支付通知到达 → 原生 TxnHeadlessTaskService 拉起 JS → 本文件执行一轮。
//
// 与前台补扫(useSmsAutoBookkeeping)的分工:
//   · 前台:启动 + 回到前台时补扫,5 分钟节流(内存 ref,切前台很频繁)
//   · 后台:通知到达即触发;5 秒窗口只合并「同一条通知的重复投递」,新交易永远放行
// 两者共用 runAutoBookkeeping 与「已处理」标记,重复触发不会重复入账。
//
// 后台拿不到任何 React 上下文,所以这里只依赖「持久化的登录凭据 + 账本 id + 开关」。

/** headless 任务名:必须与原生 TxnHeadlessTaskService.TASK_KEY 一致 */
const TASK_KEY = 'TxnAutoBookkeeping';

/**
 * 「没有新通知时」的重复触发合并窗口 —— **不是记账间隔**。
 *
 * 语义只有一条:队列里没有比上次执行更新的通知时,这么短时间内别再来一轮。
 * 一旦出现新通知(见 hasFreshNotification),无论隔了 0.5 秒还是 5 秒都会立刻执行,
 * 所以这个值调大调小都不影响「连续两笔会不会漏」。
 *
 * 取 5 秒而不是更短:窗口至少要覆盖一轮执行的典型耗时(本地扫描 + 一次后端提交)。
 * 若短于执行耗时,同一条通知的重复回调就会在上一轮还没结束时挤进来,只能卡在锁上白等。
 * 再长也没有额外收益 —— 原生侧已经用 postTime 把「同一条通知」的重复回调合并掉了。
 */
export const BACKGROUND_MIN_INTERVAL_MS = 5_000;

function logBg(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[自动记账·后台]', ...args);
}

/**
 * 节流窗口内是否出现了「上次执行之后才到达」的通知。
 *
 * 这是「节流不会漏记」的关键:队列里出现比 lastRunAt 更新的条目,
 * 说明刚发生了一笔新交易 —— 必须立刻再扫一轮,不能因为「距上次不到 15 秒」丢掉。
 *
 * postedAt 是系统通知的 postTime,与本机 Date.now() 同源,可直接比较。
 * (被规则排除的通知不会反复触发:它只在刚到达时比 lastRunAt 新,跑一轮后 lastRunAt 就更新了。)
 */
async function hasFreshNotification(lastRunAt: number): Promise<boolean> {
  try {
    const list = await getPendingNotifications();
    // postedAt 为 0(极少数 ROM 不给 postTime)时按「有更新」处理:
    // 否则首次执行(lastRunAt=0)会判成「没有新通知」,整批被节流掉
    return list.some((n) => !n.postedAt || n.postedAt > lastRunAt);
  } catch {
    // 队列读不到(权限被收回/原生异常):宁可跑一轮 —— 漏记比多打一次接口更糟
    return true;
  }
}

/**
 * 在后台跑一轮自动记账。
 * 返回 null 表示「条件不满足而未执行」(未登录/未开开关/无账本/节流中/并发中)。
 * 任何异常都在内部吞掉 —— 后台失败不该留下崩溃日志,也不该重试打服务器。
 */
export async function runAutoBookkeepingInBackground(): Promise<AutoRunResult | null> {
  if (Platform.OS !== 'android') return null;

  const settings = await loadAutoSettings();
  if (!settings.enabled) {
    logBg('跳过:自动记账开关未开启');
    return null;
  }

  // headless 没有 App 启动时的初始化:baseUrl 要自己恢复,凭据从安全存储读
  await getCurrentServer().catch(() => null);
  const cred = await getCredential();
  if (!cred) {
    logBg('跳过:未登录');
    return null;
  }

  const bookId = await loadAutoBookBookId();
  if (!bookId) {
    logBg('跳过:没有可用的账本 id(先在应用内打开一次)');
    return null;
  }

  // 节流 + 互斥都在写时间戳之前完成,避免并发两轮都通过检查。
  // 时间戳与前台 hook 共享:前台刚跑过(哪怕 1 秒前)就不必再扫一遍。
  // 但「节流期内又来了新交易」必须放行 —— 否则短时间连续两笔只会记第一笔。
  const last = await loadAutoBookLastRun();
  const waitMs = BACKGROUND_MIN_INTERVAL_MS - (Date.now() - last);
  // 节流只挡「没有新通知」的重复触发,新交易永远放行(见 hasFreshNotification)
  if (waitMs > 0 && !(await hasFreshNotification(last))) return null;

  // 上一轮还在跑(典型:第一笔的通知正在提交)时,这一条**不是重复**,不能直接丢 ——
  // 等它结束后重试几次。若直接返回,这条通知会一直躺在队列里,直到下一条通知或回前台。
  if (!(await acquireAutoBookLock())) {
    let acquired = false;
    for (let i = 0; i < 3 && !acquired; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      acquired = await acquireAutoBookLock();
    }
    if (!acquired) return null;
  }
  await markAutoBookRan();

  try {
    // 保证通知渠道存在(正常应先在前台初始化过;headless 冷启动时补一次,幂等)
    await setupNotifications();
    const res = await runAutoBookkeeping(bookId);
    logBg('执行结果', { imported: res.imported, pending: res.pending, reason: res.reason });
    if (res.imported > 0 && res.notify !== false) {
      // 后台没有 toast,系统通知是唯一的可见反馈(点它直达对应流水)
      await postBookkeepingNotifications(res.items ?? []);
    }
    return res;
  } catch (e) {
    logBg('异常', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    await releaseAutoBookLock();
  }
}

/**
 * 注册 headless 任务。必须在 JS bundle 加载时执行(见 index.js),
 * 否则原生 startService 后会因「任务未注册」而拿到 task not found。
 * 重复注册是幂等的(同名覆盖)。
 */
export function registerAutoBookkeepingHeadlessTask(): void {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask(TASK_KEY, () => async () => {
    await runAutoBookkeepingInBackground();
  });
  logBg('headless 任务已注册');
}
