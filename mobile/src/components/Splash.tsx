import { useEffect } from 'react';
import { Image, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useTheme, motion } from '@/theme';
import { Text } from '@/components/ui/Text';

interface SplashProps {
  /** 展示完成后回调(用于卸载此层) */
  onDone: () => void;
}

// 开屏 logo 展示:居中 logo 占位 + 品牌字,带淡入淡出
// logo 图:assets/images/logo-placeholder.png(空白占位,后续替换为正式 logo)
const LOGO = require('@/assets/images/logo-placeholder.png');
// 总时长:显示 700ms 后淡出 320ms
const HOLD_MS = 700;

export function Splash({ onDone }: SplashProps) {
  const { colors, fonts } = useTheme();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.92);

  useEffect(() => {
    // 淡入 + 微缩放
    opacity.value = withTiming(1, { duration: motion.duration.base, easing: motion.easing });
    scale.value = withTiming(1, { duration: motion.duration.slow, easing: motion.easing });
    // 停留后淡出,完成后通知上层卸载
    // 注意:withTiming 的 completion 回调运行在 UI Runtime(worklet),
    // 不能直接调用 JS 线程的 onDone,需用 runOnJS 切回 JS 线程
    opacity.value = withDelay(
      HOLD_MS,
      withTiming(0, { duration: motion.duration.slow, easing: motion.easing }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
      }}
    >
      <Animated.View style={[{ alignItems: 'center', gap: 16 }, animStyle]}>
        <Image
          source={LOGO}
          resizeMode="contain"
          style={{ width: 120, height: 120, borderRadius: 24 }}
        />
        <Text
          style={{
            fontFamily: fonts.display,
            color: colors.foreground,
            fontSize: 28,
            fontWeight: '800',
            letterSpacing: -1,
          }}
        >
          homi<Text style={{ color: colors.primary }}>book</Text>
        </Text>
      </Animated.View>
    </View>
  );
}
