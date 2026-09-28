import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';

interface LoadingStateProps {
  /** 文案；传 null 只显示转圈 */
  text?: string | null;
  /** 上下留白，列表内联时可调小 */
  paddingVertical?: number;
}

/**
 * 统一的加载占位（居中转圈 + 文案）。
 *
 * 页面/弹窗在「数据未回来」时必须用它占位，而不是渲染空态或 0 值：
 * 否则大列表/重图表会先按空数据渲染一帧再整体重排，看起来就是卡顿；而且空态文案会误导用户。
 * 样式只此一份，避免各页各写一个 ActivityIndicator 导致留白/颜色漂移。
 */
export function LoadingState({ text = '加载中...', paddingVertical = 40 }: LoadingStateProps) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical }}>
      <ActivityIndicator color={colors.primary} />
      {text ? (
        <Text variant="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}
