import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, Pattern, Polygon, RadialGradient, Rect, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';
import { alpha } from './tokens';
import type { Palette } from './palettes';

// 主题装饰层:按主题渲染背景纹理与侧边栏装饰(对齐 web 端 [data-theme] CSS 装饰层的「重点复刻」)
// 全部为静态 SVG/View,无 Reanimated 驱动(唯一动画是电报机状态灯,且由抽屉开关门控);
// 纹理颜色一律经 alpha() 从主题色派生,遵守「淡彩底色必须用 alpha()」的项目规范。

/** 页面背景纹理(Screen 内容之下,absoluteFill) */
export function ThemeBackdrop({ palette }: { palette: Palette }) {
  const c = palette.colors;
  switch (palette.decor.backdrop) {
    // 手工杂货铺:牛皮纸账页横线 + 左缘红墨水线
    case 'ledger':
      return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Pattern id="bdLedgerLine" width="8" height="28" patternUnits="userSpaceOnUse">
              <Rect x="0" y="27" width="8" height="1" fill={alpha(c.border, 0.35)} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#bdLedgerLine)" />
          <Rect x={18} y="0" width="1" height="100%" fill={alpha(c.expense, 0.06)} />
        </Svg>
      );
    // 旧式电报机:CRT 扫描线 + 上方荧光渐变
    case 'scanlines':
      return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <RadialGradient id="bdTgGlow" cx="50%" cy="0%" rx="90%" ry="60%">
              <Stop offset="0%" stopColor={c.primary} stopOpacity={0.07} />
              <Stop offset="100%" stopColor={c.primary} stopOpacity={0} />
            </RadialGradient>
            <Pattern id="bdTgScan" width="4" height="4" patternUnits="userSpaceOnUse">
              <Rect x="0" y="0" width="4" height="2" fill={alpha('#000000', 0.25)} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#bdTgGlow)" />
          <Rect width="100%" height="100%" fill="url(#bdTgScan)" />
        </Svg>
      );
    // 植物记账簿:奶油纸纤维横线 + 干花种子点
    case 'fiber':
      return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Pattern id="bdBotFiber" width="80" height="13" patternUnits="userSpaceOnUse">
              <Rect x="0" y="12" width="80" height="1" fill={alpha(c.foreground, 0.03)} />
            </Pattern>
            <Pattern id="bdBotSeed" width="90" height="70" patternUnits="userSpaceOnUse">
              <Circle cx="12" cy="20" r="1.2" fill={alpha(c.accent, 0.05)} />
              <Circle cx="60" cy="45" r="1" fill={alpha(c.accent, 0.05)} />
              <Circle cx="30" cy="62" r="1.4" fill={alpha(c.accent, 0.04)} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#bdBotFiber)" />
          <Rect width="100%" height="100%" fill="url(#bdBotSeed)" />
        </Svg>
      );
    // 原色构成:24×24 毫米方格纸
    case 'grid':
      return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Pattern id="bdMondGrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <Rect x="23" y="0" width="1" height="24" fill={alpha(c.foreground, 0.1)} />
              <Rect x="0" y="23" width="24" height="1" fill={alpha(c.foreground, 0.1)} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#bdMondGrid)" />
        </Svg>
      );
    default:
      return null;
  }
}

/** 侧边栏装饰层(面板内容之下,absoluteFill;active=抽屉是否打开,门控状态灯动画) */
export function SidebarDecor({ palette, active }: { palette: Palette; active: boolean }) {
  const c = palette.colors;
  const s = palette.sidebar!;
  switch (palette.id) {
    // 手工杂货铺:45° 交叉斜纹布面 + 内缩虚线装饰框
    case 'craft':
      return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <Pattern id="sbCraftWeave" width="8" height="8" patternUnits="userSpaceOnUse">
                <Path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" stroke={alpha(s.border, 0.35)} strokeWidth={1} fill="none" />
              </Pattern>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#sbCraftWeave)" />
            <Rect x="2.5%" y="2%" width="95%" height="96%" rx={12} fill="none" stroke={alpha(s.border, 0.4)} strokeWidth={1} strokeDasharray="6 6" />
          </Svg>
        </View>
      );
    // 旧式电报机:面板扫描线 + 顶部荧光 + 脉冲状态灯
    case 'telegram':
      return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <SvgLinearGradient id="sbTgGlow" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={c.primary} stopOpacity={0.14} />
                <Stop offset="100%" stopColor={c.primary} stopOpacity={0} />
              </SvgLinearGradient>
              <Pattern id="sbTgScan" width="4" height="4" patternUnits="userSpaceOnUse">
                <Rect x="0" y="0" width="4" height="2" fill={alpha('#000000', 0.28)} />
              </Pattern>
            </Defs>
            <Rect width="100%" height="140" fill="url(#sbTgGlow)" />
            <Rect width="100%" height="100%" fill="url(#sbTgScan)" />
          </Svg>
          <View style={{ position: 'absolute', top: 16, right: 16 }}>
            <StatusDot active={active} />
          </View>
        </View>
      );
    // 植物记账簿:纸纤维 + 🌱图章 + 底部信封舌片 + 麻绳圈
    case 'botanical':
      return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <Pattern id="sbBotFiber" width="80" height="13" patternUnits="userSpaceOnUse">
                <Rect x="0" y="12" width="80" height="1" fill={alpha(s.foreground, 0.05)} />
              </Pattern>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#sbBotFiber)" />
          </Svg>
          <Text style={{ position: 'absolute', top: 72, right: 18, fontSize: 20, opacity: 0.55, transform: [{ rotate: '12deg' }] }}>🌱</Text>
          {/* 底部信封舌片(倒 V 收口) */}
          <Svg
            viewBox="0 0 100 26"
            preserveAspectRatio="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, width: '100%' }}
          >
            <Polygon points="0,0 100,0 100,21 50,26 0,21" fill={alpha('#000000', 0.12)} />
          </Svg>
          {/* 麻绳圈(舌片上方) */}
          <Svg
            width={22}
            height={22}
            style={{ position: 'absolute', bottom: 30, alignSelf: 'center' }}
          >
            <Circle cx="11" cy="11" r="7" fill="none" stroke={alpha(s.border, 0.6)} strokeWidth={1.5} />
            <Circle cx="11" cy="11" r="4" fill="none" stroke={alpha(s.border, 0.4)} strokeWidth={1} />
          </Svg>
        </View>
      );
    // 原色构成:右缘红蓝原色小块(静态,面板 3px 黑边由 border 承担)
    case 'mondrian':
      return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={{ position: 'absolute', top: 88, right: 12, width: 14, height: 14, backgroundColor: c.primary, borderWidth: 2, borderColor: c.border }} />
          <View style={{ position: 'absolute', top: 110, right: 12, width: 14, height: 14, backgroundColor: c.accent, borderWidth: 2, borderColor: c.border }} />
        </View>
      );
    default:
      return null;
  }
}

/** 电报机脉冲状态灯:抽屉打开时呼吸闪烁,关闭时静止(避免常驻渲染下的后台空转) */
function StatusDot({ active }: { active: boolean }) {
  const opacity = useSharedValue(1);
  const color = 'hsl(120, 80%, 50%)'; // CRT 荧光绿,电报机主题专属标识色
  useEffect(() => {
    if (active) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.25, { duration: 1000, easing: Easing.linear }),
          withTiming(1, { duration: 1000, easing: Easing.linear }),
        ),
        -1,
      );
    } else {
      cancelAnimation(opacity);
      opacity.value = withTiming(1, { duration: 150 });
    }
    return () => cancelAnimation(opacity);
  }, [active, opacity]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{
        width: 8, height: 8, borderRadius: 4, backgroundColor: color,
        shadowColor: color, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
      }, dotStyle]}
    />
  );
}
