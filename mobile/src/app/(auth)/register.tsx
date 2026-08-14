import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, Link } from 'expo-router';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';

export default function RegisterScreen() {
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const inputStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    color: colors.foreground,
  };

  return (
    <Screen keyboard>
      <View className="flex-1 px-6 pt-8">
        <Pressable onPress={() => router.back()} className="mb-6" style={{ alignSelf: 'flex-start' }}>
          <ArrowLeft size={24} color={colors.foreground} />
        </Pressable>

        <FadeInView>
          <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4, color: colors.foreground }}>创建账号</Text>
          <Text variant="muted" style={{ fontSize: 13, marginBottom: 32 }}>注册一个家庭共用账本</Text>

          <View className="gap-3">
            <TextInput value={username} onChangeText={setUsername} placeholder="账号" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" className="h-[50px] rounded-2xl border px-4" style={inputStyle} />
            <TextInput value={email} onChangeText={setEmail} placeholder="邮箱地址" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" keyboardType="email-address" className="h-[50px] rounded-2xl border px-4" style={inputStyle} />
            <TextInput value={nickname} onChangeText={setNickname} placeholder="昵称（可选）" placeholderTextColor={colors.mutedForeground} className="h-[50px] rounded-2xl border px-4" style={inputStyle} />
            <View className="relative">
              <TextInput value={password} onChangeText={setPassword} placeholder="密码（至少6位）" placeholderTextColor={colors.mutedForeground} secureTextEntry={!showPwd} className="h-[50px] rounded-2xl border px-4 pr-12" style={inputStyle} />
              <Pressable className="absolute right-4 top-1/2" style={{ transform: [{ translateY: -11 }] }} onPress={() => setShowPwd((v) => !v)}>
                {showPwd ? <EyeOff size={20} color={colors.mutedForeground} /> : <Eye size={20} color={colors.mutedForeground} />}
              </Pressable>
            </View>

            <Button
              title="注 册"
              size="lg"
              style={{ marginTop: 8 }}
              onPress={() => {
                // 模拟注册,设计优先阶段不接真实后端
                router.replace('/(tabs)');
              }}
            />
            <View className="flex-row justify-center gap-1 mt-2">
              <Text variant="muted">已有账号?</Text>
              <Link href="/login" style={{ color: colors.primary, fontWeight: '600' }}>去登录</Link>
            </View>
          </View>
        </FadeInView>
      </View>
    </Screen>
  );
}