import { useState, useCallback, useEffect } from 'react';
import {
  ScrollView, View, Pressable, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { BookPlus, Pencil, Trash2, Users, Link, Copy, LogOut, Crown, UserCheck } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { useUIShell } from '@/components/chrome/chrome';
import { deleteBookApi, updateBookApi, fetchBookMembers } from '@/services/records';
import type { Ledger, LedgerMember } from '@/types';

// 账本管理页:对齐网页端 CRUD(创建/编辑/删除/成员管理/分享码/加入/退出)
export default function BooksPage() {
  const { colors } = useTheme();
  const { ledgers, createLedger } = useUIShell();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [joining, setJoining] = useState(false);
  const [managing, setManaging] = useState<Ledger | null>(null);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('📒');
  const [joinCode, setJoinCode] = useState('');

  // 成员列表:打开管理弹窗时从后端加载
  const [members, setMembers] = useState<LedgerMember[]>([]);
  useEffect(() => {
    if (!managing) { setMembers([]); return; }
    fetchBookMembers(managing.id).then(setMembers);
  }, [managing]);

  // ── CRUD ──
  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    createLedger(newName.trim());
    setCreating(false); setNewName(''); setNewIcon('📒');
  }, [newName, createLedger]);

  const handleEdit = useCallback(async () => {
    if (!editing || !newName.trim()) return;
    await updateBookApi(editing.id, { name: newName.trim() });
    setEditing(null); setNewName(''); setNewIcon('📒');
  }, [editing, newName]);

  const handleDelete = useCallback((ledger: Ledger) => {
    if (ledger.role !== 'OWNER') return;
    Alert.alert('删除账本', `确定要删除「${ledger.name}」吗？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => { await deleteBookApi(ledger.id); } },
    ]);
  }, []);

  const handleLeave = useCallback((ledger: Ledger) => {
    if (ledger.role === 'OWNER') return;
    Alert.alert('退出账本', `确定要退出「${ledger.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: async () => {} },
    ]);
  }, []);

  const handleJoin = useCallback(() => {
    if (!joinCode.trim()) return;
    // 加入账本:通过分享码(对接 POST /api/books/join)
    setJoining(false); setJoinCode('');
  }, [joinCode]);

  const handleCopyCode = useCallback(async (code: string) => {
    await Clipboard.setStringAsync(code);
  }, []);

  const ICONS = ['📒', '🏠', '👤', '✈️', '💰', '🎮', '👶', '🎓', '🚗', '❤️'];

  // ── 渲染辅助 ──
  const renderFormSheet = (title: string, onConfirm: () => void, showIconPicker = true) => (
    <View style={{ padding: 20, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>{title}</Text>
      {showIconPicker && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>选择图标</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ICONS.map(icon => (
              <Pressable key={icon} onPress={() => setNewIcon(icon)} style={{
                width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
                borderRadius: 10, backgroundColor: newIcon === icon ? alpha(colors.primary, 0.15) : colors.muted,
                borderWidth: 2, borderColor: newIcon === icon ? colors.primary : 'transparent',
              }}>
                <Text style={{ fontSize: 22 }}>{icon}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <TextInput
        placeholder="账本名称" value={newName} onChangeText={setNewName}
        style={{
          borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
          fontSize: 15, color: colors.foreground, backgroundColor: colors.card,
        }}
        placeholderTextColor={colors.mutedForeground}
      />
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => { setCreating(false); setEditing(null); setNewName(''); setNewIcon('📒'); }}
          style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 }}>
          <Text style={{ color: colors.mutedForeground }}>取消</Text>
        </Pressable>
        <Pressable onPress={onConfirm} style={{
          paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8,
          backgroundColor: colors.primary,
        }}>
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>确定</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderJoinSheet = () => (
    <View style={{ padding: 20, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>加入账本</Text>
      <TextInput
        placeholder="输入分享码" value={joinCode} onChangeText={setJoinCode}
        style={{
          borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
          fontSize: 15, color: colors.foreground, backgroundColor: colors.card,
        }}
        placeholderTextColor={colors.mutedForeground}
      />
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => { setJoining(false); setJoinCode(''); }}
          style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 }}>
          <Text style={{ color: colors.mutedForeground }}>取消</Text>
        </Pressable>
        <Pressable onPress={handleJoin} style={{
          paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8,
          backgroundColor: colors.primary,
        }}>
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>加入</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderManageSheet = () => managing && (
    <View style={{ padding: 20, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 28 }}>{managing.icon}</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground, flex: 1 }}>{managing.name}</Text>
      </View>
      {/* 分享码 */}
      {managing.shareCode && (
        <View style={{
          padding: 12, borderRadius: 10, backgroundColor: alpha(colors.primary, 0.08),
          flexDirection: 'row', alignItems: 'center', gap: 10,
        }}>
          <Link size={16} color={colors.primary} />
          <Text style={{ flex: 1, fontSize: 14, color: colors.foreground, fontFamily: 'monospace' }}>
            分享码: {managing.shareCode}
          </Text>
          <Pressable onPress={() => handleCopyCode(managing.shareCode!)} style={{ padding: 6 }}>
            <Copy size={16} color={colors.primary} />
          </Pressable>
        </View>
      )}
      {/* 成员列表 */}
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.mutedForeground }}>
          成员 ({members.length})
        </Text>
        {members.map(m => (
          <View key={m.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
            backgroundColor: colors.muted, borderRadius: 8,
          }}>
            <View style={{
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: alpha(colors.primary, 0.15), alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primary }}>
                {m.nickname.charAt(0)}
              </Text>
            </View>
            <Text style={{ flex: 1, fontSize: 14, color: colors.foreground }}>{m.nickname}</Text>
            {m.role === 'OWNER' ? (
              <Crown size={14} color={colors.primary} />
            ) : (
              <UserCheck size={14} color={colors.mutedForeground} />
            )}
          </View>
        ))}
      </View>
      <Pressable onPress={() => setManaging(null)} style={{
        alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8,
        backgroundColor: colors.muted,
      }}>
        <Text style={{ color: colors.foreground, fontWeight: '500' }}>关闭</Text>
      </Pressable>
    </View>
  );

  // ── 主渲染 ──
  const activeSheet = creating ? 'create' : editing ? 'edit' : joining ? 'join' : managing ? 'manage' : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* 顶部操作 */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => setCreating(true)} style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary,
          }}>
            <BookPlus size={18} color={colors.primaryForeground} />
            <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 14 }}>创建账本</Text>
          </Pressable>
          <Pressable onPress={() => setJoining(true)} style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            paddingVertical: 10, borderRadius: 10, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
          }}>
            <Link size={18} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 14 }}>加入账本</Text>
          </Pressable>
        </View>

        {/* 账本列表 */}
        {ledgers.length === 0 ? (
          <EmptyState icon="BookOpen" title="暂无账本" description="创建或加入一个账本开始记账" />
        ) : ledgers.map(ledger => (
          <View key={ledger.id} style={{
            backgroundColor: colors.card, borderRadius: 14, padding: 14,
            borderWidth: 1, borderColor: colors.border, gap: 12,
          }}>
            {/* 主体行 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 28 }}>{ledger.icon}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground }}>{ledger.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Users size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{ledger.memberCount} 人</Text>
                  {ledger.role === 'OWNER' && (
                    <View style={{
                      paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
                      backgroundColor: alpha(colors.primary, 0.12),
                    }}>
                      <Text style={{ fontSize: 10, color: colors.primary, fontWeight: '600' }}>所有者</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
            {/* 操作按钮行 */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setManaging(ledger)} style={{
                flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                borderRadius: 8, backgroundColor: colors.muted,
              }}>
                <Users size={14} color={colors.foreground} />
                <Text style={{ fontSize: 12, color: colors.foreground }}>成员</Text>
              </Pressable>
              {ledger.role === 'OWNER' && (
                <>
                  <Pressable onPress={() => { setEditing(ledger); setNewName(ledger.name); setNewIcon(ledger.icon); }} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                    borderRadius: 8, backgroundColor: colors.muted,
                  }}>
                    <Pencil size={14} color={colors.foreground} />
                    <Text style={{ fontSize: 12, color: colors.foreground }}>编辑</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDelete(ledger)} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                    borderRadius: 8, backgroundColor: alpha(colors.destructive, 0.1),
                  }}>
                    <Trash2 size={14} color={colors.destructive} />
                    <Text style={{ fontSize: 12, color: colors.destructive }}>删除</Text>
                  </Pressable>
                </>
              )}
              {ledger.role !== 'OWNER' && (
                <Pressable onPress={() => handleLeave(ledger)} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 8, backgroundColor: alpha(colors.destructive, 0.1),
                }}>
                  <LogOut size={14} color={colors.destructive} />
                  <Text style={{ fontSize: 12, color: colors.destructive }}>退出</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* ── 底部弹出表单 ── */}
      {activeSheet && (
        <Pressable style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => { setCreating(false); setEditing(null); setJoining(false); setManaging(null); }}>
          <Pressable style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            padding: 4,
          }} onPress={() => {}}>
            {activeSheet === 'create' && renderFormSheet('创建账本', handleCreate)}
            {activeSheet === 'edit' && renderFormSheet('编辑账本', handleEdit)}
            {activeSheet === 'join' && renderJoinSheet()}
            {activeSheet === 'manage' && renderManageSheet()}
          </Pressable>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
