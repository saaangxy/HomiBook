import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ScrollView, View, Pressable, TextInput, Keyboard, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { BookPlus, Pencil, Trash2, Users, Link, Copy, LogOut, Crown, UserCheck, Plus, RefreshCw, X } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmSheet } from '@/components/chrome/ConfirmSheet';
import { showToast } from '@/components/chrome/Toast';
import { useUIShell } from '@/components/chrome/chrome';
import { useAuth } from '@/stores/auth';
import {
  deleteBookApi, updateBookApi, fetchBookMembers,
  addBookMemberApi, removeBookMemberApi, updateBookMemberRoleApi,
  generateShareCodeApi, listShareCodesApi, deleteShareCodeApi, joinBookByCodeApi,
} from '@/services/records';
import type { Ledger, LedgerMember, ShareCodeItem } from '@/types';

// 账本管理页:对齐网页端 CRUD(创建/编辑/删除/成员管理/分享码/加入/退出)
export default function BooksPage() {
  const { colors } = useTheme();
  const { ledgers, createLedger, refreshLedgers } = useUIShell();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [joining, setJoining] = useState(false);
  const [managing, setManaging] = useState<Ledger | null>(null);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [addEmail, setAddEmail] = useState('');

  // 键盘高度:e2e 下 adjustResize 不生效,底部弹层需自行避让(同 server/profile 页方案)
  const winH = useRef(Dimensions.get('window').height).current;
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 成员列表 + 分享码:打开管理弹窗时从后端加载
  const [members, setMembers] = useState<LedgerMember[]>([]);
  const [shareCodes, setShareCodes] = useState<ShareCodeItem[]>([]);
  useEffect(() => {
    if (!managing) { setMembers([]); setShareCodes([]); return; }
    fetchBookMembers(managing.id).then(setMembers);
    listShareCodesApi(managing.id).then(setShareCodes);
  }, [managing]);

  // 危险操作二次确认(ConfirmSheet 统一替代系统 Alert)
  const [confirm, setConfirm] = useState<{
    title: string; message?: string; confirmLabel?: string; onConfirm: () => void;
  } | null>(null);

  // ── CRUD ──
  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    createLedger(newName.trim());
    setCreating(false); setNewName('');
  }, [newName, createLedger]);

  const handleEdit = useCallback(async () => {
    if (!editing || !newName.trim()) return;
    await updateBookApi(editing.id, { name: newName.trim() });
    setEditing(null); setNewName('');
  }, [editing, newName]);

  const handleDelete = useCallback((ledger: Ledger) => {
    if (ledger.role !== 'OWNER') return;
    setConfirm({
      title: '删除账本',
      message: `确定要删除「${ledger.name}」吗？此操作不可恢复。`,
      onConfirm: () => deleteBookApi(ledger.id),
    });
  }, []);

  const handleLeave = useCallback((ledger: Ledger) => {
    if (ledger.role === 'OWNER') return;
    setConfirm({
      title: '退出账本',
      message: `确定要退出「${ledger.name}」吗？`,
      confirmLabel: '退出',
      onConfirm: async () => {
        // 当前用户对应成员 id:退出=移除自己
        const ms = await fetchBookMembers(ledger.id).catch(() => []);
        const me = ms.find((m) => m.userId === user?.id);
        if (me) {
          await removeBookMemberApi(ledger.id, me.id).catch(() => {});
          await refreshLedgers();
        }
      },
    });
  }, [user, refreshLedgers]);

  const handleJoin = useCallback(async () => {
    if (!joinCode.trim()) return;
    await joinBookByCodeApi(joinCode.trim()).catch(() => {});
    setJoining(false); setJoinCode('');
    await refreshLedgers();
  }, [joinCode, refreshLedgers]);

  const handleCopyCode = useCallback(async (code: string) => {
    await Clipboard.setStringAsync(code);
    showToast('分享码已复制');
  }, []);

  // ── 渲染辅助 ──
  const renderFormSheet = (title: string, onConfirm: () => void) => (
    <View style={{ padding: 20, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>{title}</Text>
      <TextInput
        placeholder="账本名称" value={newName} onChangeText={setNewName}
        style={{
          borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
          fontSize: 15, color: colors.foreground, backgroundColor: colors.card,
        }}
        placeholderTextColor={colors.mutedForeground}
      />
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => { setCreating(false); setEditing(null); setNewName(''); }}
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
    // 内容较长(分享码+成员列表)且键盘弹出时会挤压,包一层可滚动容器,高度随键盘收缩
    <ScrollView
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      style={{ maxHeight: Math.min(640, winH - 140 - kbH) }}
      contentContainerStyle={{ padding: 20, gap: 16 }}
    >
      <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground, flex: 1 }}>{managing.name}</Text>
        <Pressable onPress={() => setManaging(null)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
          <X size={17} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {/* 分享码管理(OWNER 可生成/删除) */}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.mutedForeground }}>分享码</Text>
          {managing.role === 'OWNER' && (
            <Pressable onPress={async () => { await generateShareCodeApi(managing.id, 168); setShareCodes(await listShareCodesApi(managing.id)); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: alpha(colors.primary, 0.1) }}>
              <RefreshCw size={12} color={colors.primary} />
              <Text style={{ fontSize: 11, color: colors.primary }}>生成</Text>
            </Pressable>
          )}
        </View>
        {shareCodes.length === 0 ? (
          <Text variant="muted" style={{ fontSize: 12 }}>暂无分享码</Text>
        ) : (
          shareCodes.map(sc => (
            <View key={sc.id} style={{
              padding: 10, borderRadius: 8, backgroundColor: alpha(colors.primary, 0.06),
              flexDirection: 'row', alignItems: 'center', gap: 8,
            }}>
              <Link size={14} color={colors.primary} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.foreground, fontFamily: 'monospace' }}>{sc.code}</Text>
              <Pressable onPress={() => handleCopyCode(sc.code)} style={{ padding: 4 }}>
                <Copy size={14} color={colors.primary} />
              </Pressable>
              {managing.role === 'OWNER' && (
                <Pressable onPress={() => setConfirm({
                  title: '删除分享码',
                  message: `确定要删除分享码「${sc.code}」吗？删除后该码将失效。`,
                  confirmLabel: '删除',
                  onConfirm: async () => { await deleteShareCodeApi(managing.id, sc.id); setShareCodes(await listShareCodesApi(managing.id)); },
                })} style={{ padding: 4 }}>
                  <Trash2 size={14} color={colors.destructive} />
                </Pressable>
              )}
            </View>
          ))
        )}
      </View>
      {/* 成员列表(OWNER 可添加/移除/改角色) */}
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.mutedForeground }}>
          成员 ({members.length})
        </Text>
        {managing.role === 'OWNER' && (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={addEmail} onChangeText={setAddEmail} placeholder="成员邮箱"
              autoCapitalize="none" style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, fontSize: 13, color: colors.foreground }}
              placeholderTextColor={colors.mutedForeground}
            />
            <Pressable onPress={async () => { if (!addEmail.trim()) return; await addBookMemberApi(managing.id, addEmail.trim()).catch(() => {}); setAddEmail(''); setMembers(await fetchBookMembers(managing.id)); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary }}>
              <Plus size={14} color={colors.primaryForeground} />
              <Text style={{ fontSize: 12, color: colors.primaryForeground }}>添加</Text>
            </Pressable>
          </View>
        )}
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
              <>
                {managing.role === 'OWNER' && (
                  <Pressable onPress={async () => { await updateBookMemberRoleApi(managing.id, m.id, 'OWNER').catch(() => {}); setMembers(await fetchBookMembers(managing.id)); }}>
                    <UserCheck size={14} color={colors.foreground} />
                  </Pressable>
                )}
                <Pressable onPress={() => {
                  setConfirm({
                    title: '移除成员',
                    message: `确定移除「${m.nickname}」吗？`,
                    confirmLabel: '移除',
                    onConfirm: async () => { await removeBookMemberApi(managing.id, m.id).catch(() => {}); setMembers(await fetchBookMembers(managing.id)); },
                  });
                }}>
                  <Trash2 size={14} color={colors.destructive} />
                </Pressable>
              </>
            )}
          </View>
        ))}
      </View>
      </View>
    </ScrollView>
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
                  <Pressable onPress={() => { setEditing(ledger); setNewName(ledger.name); }} style={{
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
            padding: 4, paddingBottom: kbH,
          }} onPress={() => {}}>
            {activeSheet === 'create' && renderFormSheet('创建账本', handleCreate)}
            {activeSheet === 'edit' && renderFormSheet('编辑账本', handleEdit)}
            {activeSheet === 'join' && renderJoinSheet()}
            {activeSheet === 'manage' && renderManageSheet()}
          </Pressable>
        </Pressable>
      )}

      {/* 危险操作二次确认 */}
      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => { const c = confirm; setConfirm(null); c?.onConfirm(); }}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}
