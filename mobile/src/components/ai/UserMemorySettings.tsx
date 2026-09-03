import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';
import { memoryApi, type UserMemory } from '@/services/settings';
import { Text } from '@/components/ui/Text';
import { ConfirmSheet } from '@/components/chrome/ConfirmSheet';

const MEMORY_TYPE_LABELS: Record<string, string> = {
  habit: '习惯',
  preference: '偏好',
  rule: '规则',
  fact: '事实',
};

// 我的 AI 记忆(所有用户可见,对齐 web 设置页 AIMemorySettings):
// 查看/编辑/删除 AI 自动保存的本人消费习惯与记账偏好
export function UserMemorySettings() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState('');
  // 删除二次确认(项目规范:勿用系统 Alert)
  const [deleteTarget, setDeleteTarget] = useState<UserMemory | null>(null);

  useEffect(() => {
    memoryApi.fetchMemories()
      .then(setMemories)
      .catch(() => setError('加载记忆失败'))
      .finally(() => setLoading(false));
  }, []);

  const startEdit = (m: UserMemory) => {
    setEditingId(m.id);
    setContent(m.content);
    setImportance(String(m.importance));
    setError('');
  };

  const saveEdit = async () => {
    const imp = parseFloat(importance);
    if (isNaN(imp) || imp < 0 || imp > 1) { setError('重要程度需为 0-1 之间的数字'); return; }
    try {
      await memoryApi.updateMemory(editingId!, { content, importance: imp });
      setMemories((prev) => prev.map((m) => (m.id === editingId ? { ...m, content, importance: imp } : m)));
      setEditingId(null);
      setError('');
    } catch (e: any) {
      setError(e?.message ?? '更新记忆失败');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await memoryApi.deleteMemory(deleteTarget.id);
      setMemories((prev) => prev.filter((x) => x.id !== deleteTarget.id));
    } catch (e: any) {
      setError(e?.message ?? '删除记忆失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  const inputStyle = {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.foreground,
    fontSize: 13.5,
  };

  return (
    <View style={{ gap: 10 }}>
      {error ? <Text style={{ fontSize: 12, color: colors.expense }}>{error}</Text> : null}
      {loading ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 10 }}>加载中...</Text>
      ) : memories.length === 0 ? (
        <Text variant="muted" style={{ fontSize: 12, textAlign: 'center', paddingVertical: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, lineHeight: 18 }}>
          暂无记忆。AI 会在对话中自动识别您的消费习惯和记账偏好并保存。
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {memories.map((m) => (
            <View key={m.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}>
              {editingId === m.id ? (
                <View style={{ gap: 8 }}>
                  <TextInput value={content} onChangeText={setContent} style={inputStyle} placeholderTextColor={colors.mutedForeground} multiline />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TextInput
                      value={importance}
                      onChangeText={setImportance}
                      keyboardType="decimal-pad"
                      placeholder="重要度 0-1"
                      placeholderTextColor={colors.mutedForeground}
                      style={[inputStyle, { width: 110 }]}
                    />
                    <Pressable onPress={saveEdit} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: colors.primary }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primaryForeground }}>保存</Text>
                    </Pressable>
                    <Pressable onPress={() => setEditingId(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: colors.muted }}>
                      <Text style={{ fontSize: 13 }}>取消</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.muted }}>
                        <Text variant="muted" style={{ fontSize: 10.5 }}>{MEMORY_TYPE_LABELS[m.memoryType] ?? m.memoryType}</Text>
                      </View>
                      <Text variant="muted" style={{ fontSize: 10.5 }}>重要度 {m.importance.toFixed(1)}</Text>
                    </View>
                    <Text style={{ fontSize: 13 }}>{m.content}</Text>
                  </View>
                  <Pressable hitSlop={6} onPress={() => startEdit(m)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.primary }}>编辑</Text>
                  </Pressable>
                  <Pressable hitSlop={6} onPress={() => setDeleteTarget(m)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.expense }}>删除</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* 删除二次确认 */}
      <ConfirmSheet
        visible={!!deleteTarget}
        title="删除记忆"
        message="确定要删除这条 AI 记忆吗?删除后 AI 将不再参考该内容。"
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </View>
  );
}
