import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// 自动记账结果提醒(本机通知)。
//
// 用 expo-notifications 而不是自研原生:以后要做定时提醒 / 远程推送 / 点击带路由参数都现成,
// 业务侧只依赖本文件 —— 换实现不影响调用方。
//
// 两个必须显式处理的点(缺了就会「发了但看不到 / 点了没反应」):
//   1) **前台展示**:expo-notifications 默认不在前台展示通知,而自动记账的触发点恰是「回到前台」,
//      必须用 setNotificationHandler 打开 banner/list;
//   2) **点击跳转**:通知 data 里带 recordIds,由 NotificationIntakeBridge 消费后打开对应流水。

/** Android 通知渠道 id */
const CHANNEL_ID = 'homibook.bookkeeping';
/** 已处理过的通知 id:冷启动时避免同一条通知被反复打开(见 getInitialNotificationTarget) */
const HANDLED_KEY = 'homibook.notifHandled';

/** 点击通知的目标(流水 id):先 stash,由布局层订阅消费 —— 服务层不依赖路由 */
let pendingTarget: string[] | null = null;
const targetListeners = new Set<(ids: string[]) => void>();

/** 订阅「点通知要打开哪几条流水」;订阅瞬间会补发一次已 stash 的目标 */
export function subscribeNotificationTarget(cb: (ids: string[]) => void): () => void {
  targetListeners.add(cb);
  if (pendingTarget) {
    const ids = pendingTarget;
    pendingTarget = null;
    cb(ids);
  }
  return () => {
    targetListeners.delete(cb);
  };
}

/** 解析通知里的目标 id */
function idsOf(response: Notifications.NotificationResponse | null): string[] | null {
  const raw = response?.notification.request.content.data?.recordIds;
  return Array.isArray(raw) ? raw.map(String) : null;
}

/**
 * 冷启动场景:App 被点通知唤起时,上次的响应在这里能拿到。
 * 用本机记录「已处理的通知 id」去重 —— 否则每次启动都会再打开一次那条流水。
 */
export async function getInitialNotificationTarget(): Promise<string[] | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    const notifId = response.notification.request.identifier;
    const handled = await AsyncStorage.getItem(HANDLED_KEY);
    if (handled === notifId) return null;
    await AsyncStorage.setItem(HANDLED_KEY, notifId);
    return idsOf(response);
  } catch {
    return null;
  }
}

let setupDone = false;

/**
 * 初始化通知能力:渠道 + 前台展示 handler + 点击监听。幂等,由布局层桥接调用一次。
 * Web 不支持,直接跳过。
 */
export async function setupNotifications(): Promise<void> {
  if (setupDone || Platform.OS === 'web') return;
  setupDone = true;

  try {
    if (Platform.OS === 'android') {
      // Android 8+ 必须先有渠道,否则通知不显示;重复调用幂等
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: '记账提醒',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // 前台也展示。注:Android 上 shouldPlaySound=false 时不会弹横幅(只进通知栏)——
    // 这是刻意的:触发点就是「回到前台」,同时还有应用内 toast,不必每次都响
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    Notifications.addNotificationResponseReceivedListener((response) => {
      const ids = idsOf(response);
      if (!ids || ids.length === 0) return;
      if (targetListeners.size === 0) {
        pendingTarget = ids;
        return;
      }
      targetListeners.forEach((cb) => cb(ids));
    });
  } catch {
    // 初始化失败不影响记账等功能
  }
}

/** 确保通知权限(Android 13+ / iOS 需运行时申请);返回当前是否可用 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/** 方向词(通知标题用) */
function directionWord(type: string): string {
  if (type === 'INCOME') return '收入';
  if (type === 'EXPENSE') return '支出';
  return '交易';
}

/**
 * 自动记账完成提醒:**每记一笔发一条**,内容就是那一条流水(方向 + 金额 + 账户)。
 *
 * 刻意不带「共 N 笔 / N 笔待确认」这类汇总:通知一条对一笔,点开直达那一笔
 * (每条通知只带自己的 recordId);待确认的条目留在扫描页让用户自己核对。
 */
export async function postBookkeepingNotifications(
  items: { recordId: string; type: string; amount: number; accountName: string | null }[],
): Promise<void> {
  for (const item of items) {
    if (!item.recordId) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `记录一笔${directionWord(item.type)}`,
          body: `${item.accountName || '未识别账户'} ¥${Math.abs(item.amount).toFixed(2)}`,
          data: { recordIds: [item.recordId] },
        },
        trigger: null, // 立即
      });
    } catch {
      // 单条失败不影响其它条,也不影响记账本身
    }
  }
}
