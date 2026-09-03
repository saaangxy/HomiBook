import { Check, X } from 'lucide-react-native';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';

// 密码强度实时提示(对齐 web 端 components/PasswordStrength):强度条 + 四项校验清单
const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const RED = '#ef4444';

interface CheckItem {
  label: string;
  met: boolean;
}

function getChecks(password: string): CheckItem[] {
  return [
    { label: '至少 8 位字符', met: password.length >= 8 },
    { label: '包含小写字母', met: /[a-z]/.test(password) },
    { label: '包含大写字母', met: /[A-Z]/.test(password) },
    { label: '包含数字', met: /[0-9]/.test(password) },
  ];
}

function getStrength(password: string): { level: string; color: string; width: number } {
  const met = getChecks(password).filter((c) => c.met).length;
  if (met <= 1) return { level: '低', color: RED, width: 25 };
  if (met <= 3) return { level: '中', color: AMBER, width: 60 };
  return { level: '高', color: GREEN, width: 100 };
}

export function PasswordStrength({ password }: { password: string }) {
  const { colors } = useTheme();
  if (!password) return null;

  const checks = getChecks(password);
  const strength = getStrength(password);

  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      {/* 强度条 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.muted }}>
          <View style={{ height: 4, borderRadius: 2, width: `${strength.width}%`, backgroundColor: strength.color }} />
        </View>
        <Text style={{ fontSize: 11, fontWeight: '500', color: strength.color }}>{strength.level}</Text>
      </View>

      {/* 校验项(两列) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {checks.map((check) => (
          <View key={check.label} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 1 }}>
            {check.met ? (
              <Check size={11} color={GREEN} />
            ) : (
              <X size={11} color={colors.mutedForeground} />
            )}
            <Text style={{ fontSize: 11, color: check.met ? GREEN : colors.mutedForeground }}>{check.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
