import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useUIShell } from '@/components/chrome/chrome';
import { fetchRecords } from '@/services/records';
import {
  getInitialNotificationTarget,
  setupNotifications,
  subscribeNotificationTarget,
} from '@/services/notifications';

// 「自动记账完成」通知的点击落点:先进流水列表,能唯一确定是哪一笔时再直接打开它的详情。
// 单独做成桥接挂在布局层 —— 服务层不该依赖路由,通知服务只负责把目标 id 抛出来。

export function NotificationIntakeBridge() {
  const router = useRouter();
  const { currentLedger, openRecord } = useUIShell();
  const bookId = currentLedger.id;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void setupNotifications();

    const open = async (ids: string[]) => {
      if (ids.length === 0) return;
      // 先进列表:即使下面拉不到具体那一条(已删除 / 翻页之外),用户也落在正确上下文
      router.push('/records');
      if (ids.length !== 1 || !bookId) return;
      try {
        const list = await fetchRecords(bookId);
        const hit = list.find((r) => r.id === ids[0]);
        if (hit) openRecord(hit);
      } catch {
        // 拉不到就停在列表页
      }
    };

    const unsubscribe = subscribeNotificationTarget((ids) => void open(ids));
    // 冷启动:App 被点通知唤起时,上一次的响应在这里补上(已去重,不会每次启动都弹)
    void getInitialNotificationTarget().then((ids) => {
      if (ids) void open(ids);
    });
    return unsubscribe;
  }, [router, bookId, openRecord]);

  return null;
}
