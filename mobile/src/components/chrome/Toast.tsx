import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';

type ToastListener = (message: string) => void;
const listeners = new Set<ToastListener>();

/** 全局轻提示:任意处调用,底部弹出深色胶囊,2.5s 后自动消失(需在根布局挂载 ToastHost) */
export function showToast(message: string) {
  for (const fn of listeners) fn(message);
}

/** 全局 toast 浮层宿主(挂在根布局覆盖层区域) */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(0);

  useEffect(() => {
    const fn: ToastListener = (message) => {
      keyRef.current += 1;
      setToast({ key: keyRef.current, message });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 3500);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom + 60, 76), alignItems: 'center', zIndex: 9999, elevation: 9999 }}
    >
      {toast ? (
        <Animated.View
          key={toast.key}
          entering={FadeInDown.duration(200)}
          exiting={FadeOutDown.duration(180)}
          style={{ maxWidth: '82%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(22,22,26,0.92)' }}
        >
          <Text style={{ fontSize: 13, color: '#fff', textAlign: 'center' }} numberOfLines={2}>
            {toast.message}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
