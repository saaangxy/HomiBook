import { Pressable, View } from 'react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from './Text';

interface ChipSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

// 单选胶囊组(气泡形式):与账户选择样式一致,替代原「触发器 + 底部弹窗」式下拉
export function ChipSelect({ value, options, onChange }: ChipSelectProps) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? alpha(colors.primary, 0.1) : colors.muted,
            }}
          >
            <Text style={{ fontSize: 12, color: selected ? colors.primary : colors.mutedForeground, fontWeight: selected ? '600' : '400' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
