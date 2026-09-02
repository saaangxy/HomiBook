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
