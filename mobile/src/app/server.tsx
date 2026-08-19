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

  const underline = { borderBottomWidth: 1, borderBottomColor: colors.border };

  return (
    <Screen>
      <View className="flex-1 px-8 pt-14">
        <View className="flex-row items-center justify-between mb-8">
          <Pressable onPress={() => router.back()}>
            <X size={22} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '500', letterSpacing: 1 }}>服务器</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* 服务器列表 */}
        <Card className="px-0 py-2">
          {servers.map((s, i) => {
            const active = currentServer?.id === s.id || (currentServer === null && i === 0);
            return (
              <FadeInView key={s.id} index={i}>
                <Pressable
                  className="flex-row items-center gap-3 px-5 py-4"
                  style={i < servers.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.hairline } : null}
                  onPress={() => switchServer(s.id)}
                >
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text style={{ fontSize: 15, fontWeight: '500' }}>{s.name}</Text>
                      {active && <Check size={15} color={colors.foreground} />}
                    </View>
                    <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>{s.baseUrl}</Text>
                  </View>
                  {!active && (
                    <Pressable onPress={() => removeServer(s.id)} className="p-1">
                      <Trash2 size={16} color={colors.mutedForeground} />
                    </Pressable>
                  )}
                </Pressable>
              </FadeInView>
            );
          })}
        </Card>

        {/* 新增 */}
        <Button
          title={adding ? '收起' : '添加服务器'}
          variant="outline"
          icon={<Plus size={16} color={colors.foreground} />}
          style={{ marginTop: 20 }}
          onPress={() => setAdding((v) => !v)}
        />
        {adding && (
          <View className="gap-6 mt-6">
            <View style={underline}>
              <TextInput value={name} onChangeText={setName} placeholder="名称（如 演示站）" placeholderTextColor={colors.mutedForeground} className="pb-2" style={{ color: colors.foreground, fontSize: 15 }} />
            </View>
            <View style={underline}>
              <TextInput value={baseUrl} onChangeText={setBaseUrl} placeholder="https://..." placeholderTextColor={colors.mutedForeground} autoCapitalize="none" className="pb-2" style={{ color: colors.foreground, fontSize: 15 }} />
            </View>
            <Button title="保存" onPress={handleAdd} />
          </View>
        )}
      </View>
    </Screen>
  );
}