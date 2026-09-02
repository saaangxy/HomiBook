import { Platform, Pressable, View } from 'react-native';
import { Save, Share2 } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from './FormSheet';
import type { DownloadMode } from '@/services/http';

/** 保存方式选择弹窗(附件下载与导出共用):保存到设备(仅 Android) + 系统分享 */
export function DownloadModeSheet({ visible, title, onMode, onClose }: {
  visible: boolean;
  title: string;
  onMode: (mode: DownloadMode) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <FormSheet visible={visible} title={title} onClose={onClose}>
      {Platform.OS === 'android' ? (
        <Pressable
          onPress={() => onMode('save')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, marginBottom: 10 }}
        >
          <Save size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600' }}>保存到设备</Text>
            <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>保存到已授权的文件夹,再次保存免选择</Text>
          </View>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => onMode('share')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border }}
      >
        <Share2 size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600' }}>系统分享</Text>
          <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>调起分享面板,发送或保存到任意位置</Text>
        </View>
      </Pressable>
    </FormSheet>
  );
}
