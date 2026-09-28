import { type ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useAppearStyle } from '@/components/ui/useAppearAnimation';

interface EmptyStateProps {
  /** 大图标(emoji 或自定义节点;后续可替换为主题 SVG 插画) */
  icon: string | ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

// 空状态:插画淡入 + 文案 + 延迟弹出的主操作按钮(共享值驱动,替代 entering —— 见 useAppearAnimation.ts 顶部说明)
export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const iconAnim = useAppearStyle({ active: true, duration: 320 });
  const titleAnim = useAppearStyle({ active: true, offsetY: 12, delay: 100 });
  const actionAnim = useAppearStyle({ active: true, offsetY: 12, delay: 300 });

  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 }}>
      <Animated.View style={iconAnim}>
        {typeof icon === 'string' ? (
          <Text style={{ fontSize: 56, textAlign: 'center' }}>{icon}</Text>
        ) : (
          icon
        )}
      </Animated.View>
      <Animated.View style={[{ alignItems: 'center', marginTop: 16 }, titleAnim]}>
        <Text variant="bold" style={{ fontSize: 16 }}>{title}</Text>
        {description && (
          <Text variant="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>
            {description}
          </Text>
        )}
      </Animated.View>
      {actionLabel && onAction && (
        <Animated.View style={[{ marginTop: 20 }, actionAnim]}>
          <Button title={actionLabel} onPress={onAction} />
        </Animated.View>
      )}
    </View>
  );
}
