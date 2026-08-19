import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Plus, Check, Link2 } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useUIShell } from '@/components/chrome/chrome';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FadeInView } from '@/components/FadeInView';
import { FormSheet } from '@/components/chrome/FormSheet';

// 账本管理:账本卡片列表(切换) + 创建 + 加入(设计优先 mock)
export default function BooksScreen() {
  const { colors } = useTheme();
  const { ledgers, currentLedger, switchLedger, createLedger } = useUIShell();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const handleCreate = () => {
    if (!name) return;
    createLedger(name);
    setName('');
    setCreateOpen(false);
  };

  const handleJoin = () => {
    if (!code) return;
    createLedger(`账本 #${code}`);
    setCode('');
    setJoinOpen(false);
  };

  const inputStyle = {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.foreground,
    fontSize: 15,
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>账本管理</Text>
          <Pressable onPress={() => setCreateOpen(true)} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(249,115,22,0.12)' }}>
            <Plus size={18} color={colors.primary} />
          </Pressable>
        </View>

        <Text variant="muted" style={{ fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>我的账本</Text>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {ledgers.map((l, i) => {
            const active = l.id === currentLedger.id;
            return (
              <FadeInView key={l.id} index={i}>
                <Card
                  className="px-5 py-4 mb-3"
                  onPress={() => switchLedger(l.id)}
                  style={{ borderWidth: 2, borderColor: active ? colors.primary : colors.border }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? 'rgba(249,115,22,0.12)' : colors.muted }}>
                      <Text style={{ fontSize: 22 }}>{l.icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600' }}>{l.name}</Text>
                        {active && (
                          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(249,115,22,0.12)' }}>
                            <Text style={{ fontSize: 10, color: colors.primary, fontWeight: '600' }}>当前</Text>
                          </View>
                        )}
                      </View>
                      <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>{l.memberCount} 位成员</Text>
                    </View>
                    {active ? <Check size={18} color={colors.primary} /> : null}
                  </View>
                </Card>
              </FadeInView>
            );
          })}
        </ScrollView>

        <Button title="通过分享码加入" variant="outline" icon={<Link2 size={16} color={colors.foreground} />} onPress={() => setJoinOpen(true)} />
      </View>

      {/* 创建账本 */}
      <FormSheet visible={createOpen} title="创建账本" onClose={() => setCreateOpen(false)} onSave={handleCreate} saveLabel="创建">
        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 2 }}>账本名称</Text>
        <TextInput value={name} onChangeText={setName} placeholder="如 家庭账本" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
      </FormSheet>

      {/* 加入账本 */}
      <FormSheet visible={joinOpen} title="加入账本" onClose={() => setJoinOpen(false)} onSave={handleJoin} saveLabel="加入">
        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 2 }}>分享码</Text>
        <TextInput value={code} onChangeText={setCode} placeholder="请输入 8 位分享码" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
      </FormSheet>
    </Screen>
  );
}