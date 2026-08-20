import { type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useTheme, motion } from '@/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

interface EmptyStateProps {
  /** 大图标(emoji 或自定义节点;后续可替换为主题 SVG 插画) */
  icon: string | ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

// 空状态:插画缩放入场 + 文案 + 延迟弹出的主操作按钮
export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 }}>
      <Animated.View entering={FadeIn.duration(motion.duration.slow)} style={{ transform: [{ scale: 1 }] }}>
        {typeof icon === 'string' ? (
          <Text style={{ fontSize: 56, textAlign: 'center' }}>{icon}</Text>
        ) : (
          icon
        )}
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(100).duration(motion.duration.base)} style={{ alignItems: 'center', marginTop: 16 }}>
        <Text variant="bold" style={{ fontSize: 16 }}>{title}</Text>
        {description && (
          <Text variant="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>
            {description}
          </Text>
        )}
      </Animated.View>
      {actionLabel && onAction && (
        <Animated.View entering={FadeInDown.delay(300).duration(motion.duration.base)} style={{ marginTop: 20 }}>
          <Button title={actionLabel} onPress={onAction} />
        </Animated.View>
      )}
    </View>
  );
}
