import { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import { MessageSquarePlus, Send, StopCircle, RefreshCw, ImagePlus, FileUp, Globe } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useChatStore } from '@/stores/chat';
import { useUIShell } from '@/components/chrome/chrome';
import { uploadImage, uploadImportFile } from '@/services/chat';
import type { Message, MessageBlock, ToolCallEntry } from '@homibook/core';
import type { Ledger } from '@/types';

// AI 助手页 —— 完整复刻 web 端 ChatWindow(会话/消息块/工具卡片/确认/建议/切换账本)

const TOOL_NAMES: Record<string, string> = {
  create_record: '记一笔',
  batch_create_records: '批量记账',
  query_records: '查询流水',
  query_summary: '收支统计',
  query_budgets: '查询预算',
  create_budget: '创建预算',
  query_recurring: '查询固定收支',
  create_recurring: '创建固定收支',
  query_accounts: '查询账户',
  create_account: '创建账户',
  web_search: '联网搜索',
  suggest_options: '补充信息',
  switch_book: '切换账本',
  preview_import: '导入预览',
  confirm_import: '确认导入',
};

export default function AIPage() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;

  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [pendingImages, setPendingImages] = useState<{ id: string; uri: string; fullUrl: string }[]>([]);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingImport, setPendingImport] = useState<{ fileId: string; name: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  const {
    sessions, currentSessionId, messages, error,
    allMessages, branchSelections,
    loadSessions, openSession, newSession, deleteSession, renameSession,
    sendMessage, retryMessage, stopStreaming, selectBranch,
  } = useChatStore();

  const isStreaming = useChatStore((s) => s.sessionCache[s.currentSessionId ?? '']?.isStreaming ?? false);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 自动滚动到底部
  useEffect(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages]);

  const handleSend = () => {
    const msg = input.trim();
    const hasPendingImages = pendingImages.length > 0;
    if ((!msg && !hasPendingImages) || isStreaming || !bookId) return;
    setInput('');
    setPendingImages([]);
    const attachmentIds = pendingImages.map((p) => p.id);
    const doSend = (forceSessionId?: string) => {
      if (!forceSessionId) {
        // 向前找最后一个有 dbId 的消息作为 parent
        let parentId: string | undefined;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].dbId) { parentId = messages[i].dbId; break; }
        }
        sendMessage(bookId, msg, parentId, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch);
      } else {
        // 新会话后的第一次发送
        sendMessage(bookId, msg, undefined, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch);
      }
    };
    if (!currentSessionId) {
      newSession(bookId).then((s) => {
        if (s) doSend(s.id);
      });
      return;
    }
    doSend();
  };

  // 选择并上传小票图片
  const handlePickImage = async () => {
    try {
      const { launchImageLibraryAsync } = await import('expo-image-picker');
      const perm = await (await import('expo-image-picker')).requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('需要相册权限'); return; }
      const result = await launchImageLibraryAsync({ mediaTypes: (await import('expo-image-picker')).MediaTypeOptions?.Images, quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const up = await uploadImage(asset.uri, asset.fileName || 'receipt.jpg', asset.mimeType || 'image/jpeg');
      setPendingImages((p) => [...p, { id: up.id, uri: up.fullUrl || up.url, fullUrl: up.fullUrl || up.url }]);
    } catch (e: any) {
      Alert.alert('上传失败', e?.message || '未知错误');
    }
  };

  // 账单导入:上传 → 保存 fileId → 由 AI(preview_import 工具)引导预览/确认导入
  const handleImport = async () => {
    try {
      const { getDocumentAsync } = await import('expo-document-picker');
      const result = await getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const up = await uploadImportFile(asset.uri, asset.name);
      setPendingImport({ fileId: (up as any).fileId, name: (up as any).filename || asset.name });
      setInput('请分析我刚上传的账单并预览，确认无误后导入。');
      Alert.alert('上传成功', '账单已上传，AI 将分析并引导你预览、确认导入。');
    } catch (e: any) {
      Alert.alert('导入失败', e?.message || '未知错误');
    }
  };

  const handleRetry = (assistantMsgId: string) => {
    if (!bookId) return;
    const idx = messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const prev = messages[idx - 1];
    if (prev.role !== 'user') return;
    const text = prev.blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n');
    if (!text) return;
    const assistantDbId = messages[idx].dbId || messages[idx].id;
    let parentId: string | undefined;
    for (let i = idx - 2; i >= 0; i--) {
      if (messages[i].dbId) { parentId = messages[i].dbId; break; }
    }
    retryMessage(assistantMsgId);
    sendMessage(bookId, text, parentId, assistantDbId);
  };

  // 会话管理:长按删除/重命名
  const handleSessionLongPress = (sessionId: string, currentTitle: string) => {
    Alert.alert('会话管理', undefined, [
      {
        text: '重命名', onPress: () => {
          if (Platform.OS === 'ios' && (Alert as any).prompt) {
            (Alert as any).prompt('重命名会话', '输入新标题', [
              { text: '取消', style: 'cancel' },
              { text: '确定', onPress: (v?: string) => { if (v?.trim()) renameSession(sessionId, v.trim()); } },
            ], 'plain-text', currentTitle);
          } else {
            // Android:直接弹出输入
            setRenameValue(currentTitle);
            setRenameTarget({ id: sessionId, title: currentTitle });
          }
        },
      },
      { text: '删除', style: 'destructive', onPress: () => deleteSession(sessionId) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const renderBlock = (block: MessageBlock) => {
    switch (block.type) {
      case 'thinking':
        return <ThinkingBlock key={block.id} block={block} />;
      case 'text':
        return block.content.trim()
          ? <MarkdownBody key={block.id} content={block.content} />
          : null;
      case 'tool-call':
        return <ToolCard key={block.id} toolCall={block} bookId={bookId} />;
      default:
        return null;
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    // 分支版本:以当前消息为父,找所有子消息(存在多个分支时显示版本选择)
    const parentKey = item.dbId || item.id;
    const childBranches = allMessages.filter((m) => m.parentMessageId === parentKey);
    const hasBranches = childBranches.length > 1;
    return (
      <View style={{ flexDirection: 'row', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
        <View style={{
          maxWidth: '82%',
          backgroundColor: isUser ? colors.primary : colors.muted,
          borderRadius: 16,
          borderTopRightRadius: isUser ? 4 : 16,
          borderTopLeftRadius: isUser ? 16 : 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}>
          <View style={{ gap: 6 }}>
            {isUser && item.attachments && item.attachments.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {item.attachments.map((a) => (
                  <Image key={a.id} source={{ uri: a.url }} style={{ width: 120, height: 120, borderRadius: 8 }} />
                ))}
              </View>
            )}
            {item.blocks.map(renderBlock)}
          </View>
          {item.role === 'assistant' && <UsageBadge usage={item.usage} />}
          {item.role === 'assistant' && !item.isStreaming && item.blocks.some((b) => b.type === 'text') && (
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <Pressable hitSlop={8} onPress={() => handleRetry(item.id)}>
                <RefreshCw size={13} color={colors.mutedForeground} />
              </Pressable>
            </View>
          )}
          {/* 分支版本选择 */}
          {hasBranches && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {childBranches.map((cb, i) => {
                const cbKey = cb.dbId || cb.id;
                const isSelected = branchSelections[parentKey] === cbKey;
                return (
                  <Pressable
                    key={cbKey}
                    onPress={() => selectBranch(parentKey, cbKey)}
                    style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: isSelected ? colors.primary : colors.hairline, backgroundColor: isSelected ? alpha(colors.primary, 0.1) : 'transparent' }}
                  >
                    <Text style={{ fontSize: 11, color: isSelected ? colors.primary : colors.mutedForeground, fontWeight: isSelected ? '600' : '400' }}>版本 {i + 1}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
      {/* 顶部:会话切换 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
        <Text style={{ fontSize: 17, fontWeight: '700', flex: 1 }}>AI 助手</Text>
        <Pressable onPress={() => { if (bookId) newSession(bookId); }} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <MessageSquarePlus size={16} color={colors.primary} />
          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '600' }}>新会话</Text>
        </Pressable>
      </View>
      {/* 会话列表横滑 */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {sessions.map((s) => {
            const active = s.id === currentSessionId;
            return (
              <Pressable
                key={s.id}
                onPress={() => openSession(s.id)}
                onLongPress={() => handleSessionLongPress(s.id, s.title || '新会话')}
                style={{
                  paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
                  backgroundColor: active ? alpha(colors.primary, 0.12) : colors.muted,
                }}
              >
                <Text style={{ fontSize: 12, color: active ? colors.primary : colors.mutedForeground, fontWeight: active ? '600' : '400' }}>
                  {s.title || '新会话'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 消息列表 */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 80, gap: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>你好，我是 AI 记账助手</Text>
            <Text variant="muted" style={{ fontSize: 13, textAlign: 'center' }}>
              可以问我「本月花了多少」「餐饮超预算了吗」
            </Text>
          </View>
        }
      />
      {error && <Text style={{ color: colors.expense, fontSize: 12, textAlign: 'center', paddingBottom: 4 }}>{error}</Text>}

      {/* 输入区 */}
      <View style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: colors.hairline }}>
        {/* 待上传图片预览 */}
        {pendingImages.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 }}>
            {pendingImages.map((img) => (
              <View key={img.id}>
                <Image source={{ uri: img.uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />
                <Pressable onPress={() => setPendingImages((p) => p.filter((x) => x.id !== img.id))} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.expense, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10 }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {/* 工具行:图片/文件/联网搜索 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 6 }}>
          <Pressable hitSlop={8} onPress={handlePickImage}>
            <ImagePlus size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable hitSlop={8} onPress={handleImport}>
            <FileUp size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setWebSearch((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Globe size={16} color={webSearch ? colors.primary : colors.mutedForeground} />
            <Text style={{ fontSize: 12, color: webSearch ? colors.primary : colors.mutedForeground, fontWeight: webSearch ? '600' : '400' }}>联网</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: colors.muted, borderRadius: 20, padding: 8 }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入消息..."
            placeholderTextColor={colors.mutedForeground}
            style={{ flex: 1, minHeight: 36, color: colors.foreground, fontSize: 14, paddingHorizontal: 6 }}
            multiline
          />
          {isStreaming ? (
            <Pressable onPress={() => stopStreaming()} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}>
              <StopCircle size={18} color={colors.foreground} />
            </Pressable>
          ) : (
            <Pressable onPress={handleSend} disabled={!input.trim()} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: input.trim() ? 1 : 0.4 }}>
              <Send size={16} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Android 重命名弹窗 */}
      <Modal
        visible={!!renameTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', backgroundColor: colors.background, borderRadius: 16, padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 12 }}>重命名会话</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="输入新标题"
              placeholderTextColor={colors.mutedForeground}
              style={{ borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, padding: 10, fontSize: 14, color: colors.foreground, marginBottom: 16 }}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setRenameTarget(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 14 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (renameTarget && renameValue.trim()) {
                    renameSession(renameTarget.id, renameValue.trim());
                  }
                  setRenameTarget(null);
                }}
                style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Markdown 渲染(react-native-markdown-display) ──
function MarkdownBody({ content }: { content: string }) {
  const { colors } = useTheme();
  const fg = colors.foreground;
  const bodyStyle = {
    body: { fontSize: 14, lineHeight: 21, color: fg },
    paragraph: { marginVertical: 2 },
    heading1: { color: fg, fontSize: 20, fontWeight: '700' as const, marginVertical: 6 },
    heading2: { color: fg, fontSize: 17, fontWeight: '700' as const, marginVertical: 5 },
    heading3: { color: fg, fontSize: 15, fontWeight: '700' as const, marginVertical: 4 },
    heading4: { color: fg, fontSize: 14, fontWeight: '700' as const, marginVertical: 3 },
    heading5: { color: fg, fontSize: 14, fontWeight: '600' as const, marginVertical: 3 },
    heading6: { color: fg, fontSize: 14, fontWeight: '600' as const, marginVertical: 3 },
    strong: { fontWeight: '700' as const, color: fg },
    em: { fontStyle: 'italic' as const },
    s: { textDecorationLine: 'line-through' as const },
    link: { color: colors.primary, textDecorationLine: 'underline' as const },
    code_inline: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), backgroundColor: alpha(colors.primary, 0.1), color: colors.primary, paddingHorizontal: 3, borderRadius: 3 },
    code_block: { backgroundColor: alpha(colors.foreground, 0.06), padding: 10, borderRadius: 6 },
    fence: { backgroundColor: alpha(colors.foreground, 0.06), padding: 10, borderRadius: 6 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.hairline, paddingLeft: 10, opacity: 0.9 },
    bullet_list_icon: { color: fg },
    ordered_list_icon: { color: fg },
    hr: { backgroundColor: colors.hairline, height: 1, marginVertical: 8 },
  } as any;
  return <Markdown style={bodyStyle}>{content}</Markdown>;
}

// ── Token 消耗展示 ──
function UsageBadge({ usage }: { usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }) {
  const { colors } = useTheme();
  if (!usage || usage.totalTokens == null) return null;
  return (
    <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 6 }}>
      输入 {usage.inputTokens ?? 0} · 输出 {usage.outputTokens ?? 0} · 共 {usage.totalTokens} tokens
    </Text>
  );
}

// ── 思考块(折叠) ──
function ThinkingBlock({ block }: { block: Extract<MessageBlock, { type: 'thinking' }> }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>思考过程</Text>
        <Text style={{ fontSize: 10, color: colors.mutedForeground, marginLeft: 'auto' }}>{open ? '收起' : '展开'}</Text>
      </Pressable>
      {open && (
        <Text style={{ padding: 10, borderTopWidth: 1, borderTopColor: colors.hairline, fontSize: 12, color: colors.mutedForeground, lineHeight: 18 }}>
          {block.content}
        </Text>
      )}
    </View>
  );
}

// ── 工具卡片 ──
function ToolCard({ toolCall, bookId }: { toolCall: ToolCallEntry; bookId: string }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [bookChoice, setBookChoice] = useState('');
  const { confirmAndContinue, respondToSuggestion, switchBook } = useChatStore();

  const status = toolCall.status;
  const name = TOOL_NAMES[toolCall.toolName] || toolCall.toolName;

  const statusColor =
    status === 'error' ? colors.expense
    : status === 'success' ? '#22c55e'
    : status === 'confirming' || status === 'switching' ? '#f59e0b'
    : status === 'suggesting' ? '#8b5cf6'
    : colors.primary;

  const getValue = (field: string) => {
    const sel = selected[field];
    if (!sel) return '';
    return sel === '__custom__' ? (custom[field] || '').trim() : sel;
  };

  const suggestion = toolCall.suggestion;

  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: alpha(statusColor, 0.4), backgroundColor: alpha(statusColor, 0.06), padding: 10, gap: 8 }}>
      {/* 头部 */}
      <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: statusColor }}>{name}</Text>
        {status === 'pending' && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>执行中...</Text>}
        {status === 'success' && <Text style={{ fontSize: 10, color: '#22c55e' }}>✓ 完成</Text>}
        {status === 'error' && <Text style={{ fontSize: 10, color: colors.expense }}>✕ 失败</Text>}
        {status === 'confirming' && <Text style={{ fontSize: 10, color: '#f59e0b' }}>待确认</Text>}
        {toolCall.durationMs != null && <Text style={{ fontSize: 9, color: colors.mutedForeground, marginLeft: 'auto' }}>{toolCall.durationMs}ms</Text>}
      </Pressable>

      {/* 参数(折叠) */}
      {expanded && toolCall.args != null && (
        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args, null, 2)}</Text>
      )}

      {/* 错误 */}
      {status === 'error' && (
        <Text style={{ fontSize: 12, color: colors.expense }}>
          {(toolCall.result as any)?.error || '执行失败'}
        </Text>
      )}

      {/* 确认 */}
      {(status === 'confirming' || toolCall.preview) && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '600' }}>需要确认此操作</Text>
          {toolCall.preview && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{toolCall.preview}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => confirmAndContinue(bookId, toolCall.toolCallId, true)} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>确认</Text>
            </Pressable>
            <Pressable onPress={() => confirmAndContinue(bookId, toolCall.toolCallId, false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}>
              <Text style={{ fontSize: 13 }}>拒绝</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 建议补充 */}
      {status === 'suggesting' && suggestion && (
        <View style={{ gap: 8 }}>
          {suggestion.questions.map((q) => {
            const sel = selected[q.field] || '';
            const val = getValue(q.field);
            return (
              <View key={q.field} style={{ gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '600' }}>{q.question}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {q.options.map((opt) => {
                    const label = typeof opt === 'string' ? opt : (opt?.label || opt?.name || opt?.description || JSON.stringify(opt));
                    const value = typeof opt === 'string' ? opt : (opt?.value || opt?.code || label);
                    const active = sel === value;
                    return (
                      <Pressable key={value} onPress={() => setSelected((p) => ({ ...p, [q.field]: value }))} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: active ? '#8b5cf6' : colors.muted }}>
                        <Text style={{ fontSize: 12, color: active ? '#fff' : colors.foreground }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                  {q.allowCustom && (
                    <>
                      <Pressable onPress={() => setSelected((p) => ({ ...p, [q.field]: '__custom__' }))} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: sel === '__custom__' ? '#8b5cf6' : colors.muted }}>
                        <Text style={{ fontSize: 12, color: sel === '__custom__' ? '#fff' : colors.foreground }}>自定义</Text>
                      </Pressable>
                      {sel === '__custom__' && (
                        <TextInput value={custom[q.field] || ''} onChangeText={(t) => setCustom((p) => ({ ...p, [q.field]: t }))} placeholder="输入内容..." placeholderTextColor={colors.mutedForeground} style={{ flex: 1, minWidth: 100, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, color: colors.foreground }} />
                      )}
                    </>
                  )}
                </View>
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => respondToSuggestion(bookId, toolCall.toolCallId, Object.fromEntries((suggestion?.questions ?? []).map((q) => [q.field, getValue(q.field)])))} style={{ flex: 1, backgroundColor: '#8b5cf6', borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>提交</Text>
            </Pressable>
            <Pressable onPress={() => respondToSuggestion(bookId, toolCall.toolCallId, null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}>
              <Text style={{ fontSize: 13 }}>取消</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 切换账本 */}
      {status === 'switching' && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '600' }}>选择要切换的账本</Text>
          <View style={{ gap: 6 }}>
            {((toolCall.result as any)?.books ?? []).map((b: Ledger) => (
              <Pressable key={b.id} onPress={() => setBookChoice(b.id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: bookChoice === b.id ? '#10b981' : colors.hairline, backgroundColor: bookChoice === b.id ? alpha('#10b981', 0.08) : 'transparent' }}>
                <Text style={{ fontSize: 13 }}>{b.name}</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{b.memberCount} 位成员</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => { if (bookChoice) switchBook(toolCall.toolCallId, bookChoice); }} disabled={!bookChoice} style={{ backgroundColor: '#10b981', borderRadius: 8, paddingVertical: 8, alignItems: 'center', opacity: bookChoice ? 1 : 0.4 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>切换到此账本</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
