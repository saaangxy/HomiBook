import { useEffect, useState } from 'react'
import { Dimensions, Keyboard } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * 底部 sheet 的固定高度：按屏幕比例取值，键盘弹出时整体压缩到键盘上方。
 *
 * 两个细节：
 * - 初始窗口高度用 useState 快照。Android 键盘弹出时 window 会 resize，
 *   直接读 `Dimensions.get('window').height` 会让 sheet 越压越矮。
 * - 主 window 是 edge-to-edge 全屏，height 基准包含状态栏，
 *   未弹键盘时显式扣除 `insets.top`，保证 sheet 顶部不越过状态栏。
 *
 * @param ratio 占屏幕高度的上限比例（AI 面板 0.92 / 记一笔 0.84）
 */
export function useSheetHeight(ratio: number): number {
  const insets = useSafeAreaInsets()
  const [screenH] = useState(() => Dimensions.get('window').height)
  const [kbH, setKbH] = useState(0)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbH(e.endCoordinates.height))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return Math.round(
    kbH > 0
      ? Math.min(screenH * ratio, screenH - kbH - 12)
      : Math.min(screenH * ratio, screenH - insets.top - 12),
  )
}
