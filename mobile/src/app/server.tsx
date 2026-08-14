import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { X, Plus, Check, Trash2 } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FadeInView } from '@/components/FadeInView';

export default function ServerScreen() {
  const { colors } = useTheme();
  const { servers, currentServer, switchServer, addServer, removeServer } = useAuth();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!name || !baseUrl) return;
    await addServer(name, baseUrl);
    setName('');
    setBaseUrl('');
    setAdding(false);
  };

  const inputStyle = { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground };

  return (
    <Screen>
      <View className="flex-1 px-5 pt-3">
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.muted }}>
            <X size={18} color={colors.foreground} />
          </Pressable>
          <Text variant="bold" style={{ fontSize: 16 }}>服务器管理</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* 服务器列表 */}
        <View className="gap-3">
          {servers.map((s, i) => {
            const active = currentServer?.id === s.id || (currentServer === null && i === 0);
            return (
              <FadeInView key={s.id} index={i}>
                <Card className="p-4 flex-row items-center gap-3">
                  <Pressable className="flex-1" onPress={() => switchServer(s.id)}>
                    <View className="flex-row items-center gap-2">
                      <Text variant="bold" style={{ fontSize: 15 }}>{s.name}</Text>
                      {active && <Check size={16} color={colors.primary} />}
                    </View>
                    <Text variant="muted" style={{ fontSize: 13 }}>{s.baseUrl}</Text>
                  </Pressable>
                  {!active && (
                    <Pressable onPress={() => removeServer(s.id)} className="p-2">
                      <Trash2 size={18} color={colors.mutedForeground} />
                    </Pressable>
                  )}
                </Card>
              </FadeInView>
            );
          })}
        </View>

        {/* 新增服务器 */}
        <Button
          title={adding ? '收起' : '添加服务器'}
          variant="outline"
          icon={<Plus size={18} color={colors.primary} />}
          style={{ marginTop: 16 }}
          onPress={() => setAdding((v) => !v)}
        />
        {adding && (
          <View className="gap-3 mt-4">
            <TextInput value={name} onChangeText={setName} placeholder="名称（如 演示站）" placeholderTextColor={colors.mutedForeground} className="rounded-2xl border px-4 py-3" style={inputStyle} />
            <TextInput value={baseUrl} onChangeText={setBaseUrl} placeholder="https://..." placeholderTextColor={colors.mutedForeground} autoCapitalize="none" className="rounded-2xl border px-4 py-3" style={inputStyle} />
            <Button title="保存服务器" onPress={handleAdd} />
          </View>
        )}
      </View>
    </Screen>
  );
}