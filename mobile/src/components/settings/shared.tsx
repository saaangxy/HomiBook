import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, TextInput, View } from 'react-native';
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';

// 设置页共享 UI 原语:手风琴分区 / 字段行 / 选项组 / 列表选择弹窗 / 输入框

export function Section({ icon, title, children, defaultOpen = false }: {
  icon: ReactNode; title: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
          {icon}
        </View>
        <Text style={{ fontSize: 15, fontWeight: '600', flex: 1 }}>{title}</Text>
        {open ? <ChevronDown size={16} color={colors.mutedForeground} /> : <ChevronRight size={16} color={colors.mutedForeground} />}
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline, gap: 14 }}>
          {children}
        </View>
      )}
    </View>
  );
}

export function Field({ label, desc, children }: { label: string; desc?: string; children?: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '500' }}>{label}</Text>
        {desc ? <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{desc}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function FieldRow({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '500' }}>{label}</Text>
        {desc ? <Text variant="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{desc}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function Chips({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? alpha(colors.primary, 0.12) : colors.elevated,
            }}
          >
            <Text style={{ fontSize: 12.5, color: active ? colors.primary : colors.foreground, fontWeight: active ? '600' : '400' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// 列表选择弹窗(替代 web Select)
export function OptionModal({ visible, title, options, value, onClose, onSelect }: {
  visible: boolean; title: string;
  options: { value: string; label: string }[];
  value?: string; onClose: () => void; onSelect: (v: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 32 }} onPress={onClose}>
        <Pressable style={{ backgroundColor: colors.card, borderRadius: 16, maxHeight: 420, overflow: 'hidden' }} onPress={() => {}}>
          <Text style={{ fontSize: 15, fontWeight: '700', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>{title}</Text>
          <Pressableish options={options} value={value} onSelect={onSelect} onClose={onClose} />
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Pressableish({ options, value, onSelect, onClose }: {
  options: { value: string; label: string }[]; value?: string;
  onSelect: (v: string) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => { onSelect(o.value); onClose(); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline }}
        >
          <Text style={{ fontSize: 14, flex: 1 }}>{o.label}</Text>
          {value === o.value ? <Check size={15} color={colors.primary} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

export function useInputStyle() {
  const { colors } = useTheme();
  return {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.foreground,
    fontSize: 13.5,
  } as const;
}

export function LabeledInput({ label, desc, value, onChangeText, placeholder, keyboardType, secure, error }: {
  label: string; desc?: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'numeric' | 'decimal-pad'; secure?: boolean; error?: string;
}) {
  const style = useInputStyle();
  const { colors } = useTheme();
  return (
    <View style={{ gap: 5 }}>
      <Text variant="muted" style={{ fontSize: 11.5 }}>{label}</Text>
      {desc ? <Text variant="muted" style={{ fontSize: 11 }}>{desc}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        style={style}
      />
      {error ? <Text style={{ fontSize: 11.5, color: colors.expense }}>{error}</Text> : null}
    </View>
  );
}

export function ErrorText({ msg }: { msg: string }) {
  const { colors } = useTheme();
  if (!msg) return null;
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: alpha(colors.expense, 0.4), backgroundColor: alpha(colors.expense, 0.08), padding: 10 }}>
      <Text style={{ fontSize: 12, color: colors.expense }}>{msg}</Text>
    </View>
  );
}

export function OkText({ msg }: { msg: string }) {
  const { colors } = useTheme();
  if (!msg) return null;
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: alpha(colors.income, 0.4), backgroundColor: alpha(colors.income, 0.08), padding: 10 }}>
      <Text style={{ fontSize: 12, color: colors.income }}>{msg}</Text>
    </View>
  );
}

// 主按钮/次按钮
export function Btn({ title, onPress, disabled, variant = 'primary', loading }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger'; loading?: boolean;
}) {
  const { colors } = useTheme();
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.expense : colors.muted;
  const fg = variant === 'primary' ? colors.primaryForeground : variant === 'danger' ? '#fff' : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', backgroundColor: bg, opacity: disabled || loading ? 0.5 : 1 }}
    >
      <Text style={{ color: fg, fontSize: 13.5, fontWeight: '600' }}>{loading ? '处理中...' : title}</Text>
    </Pressable>
  );
}
