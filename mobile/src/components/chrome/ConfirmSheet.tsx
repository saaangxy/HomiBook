import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from './FormSheet';

/** 自定义确认弹窗(替代系统 Alert):删除等危险操作二次确认共用 */
export function ConfirmSheet({ visible, title, message, confirmLabel = '删除', onConfirm, onClose }: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <FormSheet visible={visible} title={title} onClose={onClose}>
      <View style={{ alignItems: 'center', paddingVertical: 6 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: alpha(colors.expense, 0.12), alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <AlertTriangle size={26} color={colors.expense} />
        </View>
        {message ? (
          <Text style={{ fontSize: 14, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 }}>{message}</Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' }}>
          <Pressable
            onPress={onClose}
            style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '500' }}>取消</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.expense, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </FormSheet>
  );
}

// ── 页面级 Confirm Provider:在作用域内挂载唯一一个 ConfirmSheet ──
// 避免 ConfirmSheet 渲染在长列表组件内部时,FormSheet 的 absoluteFill 填充的是
// 组件根 View(被内容撑到几千 px),底部 sheet 落在屏幕外用户需滚动很远才能看到。
// 用法:页面顶层包 <ConfirmProvider>,子组件用 useConfirm() 触发。
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => void;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/** 调用 confirm({title, message, onConfirm}) 触发二次确认弹窗,必须在 ConfirmProvider 内使用 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  return ctx.confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);

  const close = useCallback(() => setOpts(null), []);
  const handleConfirm = useCallback(() => {
    const o = opts;
    setOpts(null);
    o?.onConfirm();
  }, [opts]);

  return (
    <ConfirmContext.Provider value={{ confirm: setOpts }}>
      {children}
      <ConfirmSheet
        visible={!!opts}
        title={opts?.title ?? ''}
        message={opts?.message}
        confirmLabel={opts?.confirmLabel}
        onConfirm={handleConfirm}
        onClose={close}
      />
    </ConfirmContext.Provider>
  );
}
