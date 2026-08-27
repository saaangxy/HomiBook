import { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, Platform, Pressable, ScrollView, TextInput, View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Bot, FileUp, Globe, ImagePlus, List, Plus, RefreshCw, Send, Sparkles, StopCircle, Trash2, X } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { useChatStore } from '@/stores/chat';
import { useUIShell } from '@/components/chrome/chrome';
import { uploadImage, uploadImportFile } from '@/services/chat';
import type { Message, MessageBlock, ToolCallEntry } from '@homibook/core';
import type { Ledger } from '@/types';

// AI 财务助手聊天主体(可嵌入:AI 弹窗 / 记一笔弹窗 AI tab)
// 复刻 web 端 ChatWindow 能力:流式/Markdown/思考块/工具卡(确认·补充信息·切换账本)/小票上传/账单导入/联网搜索/重试/分支
// 根布局为普通 View flex:1 三段式(会话工具行/消息列表/输入区),由宿主提供弹窗与键盘避让容器

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

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!ts || isNaN(ts)) return '-';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 空状态快捷指令(点击填入输入框,降低上手门槛)
const QUICK_PROMPTS = ['本月花了多少？', '餐饮超预算了吗？', '帮我分析支出趋势'];

// onClose:宿主为独立弹窗时提供关闭按钮(渲染在工具行右侧);嵌入 RecordModal 等容器时不传
export function AIAssistant({ onClose }: { onClose?: () => void }) {
  const { colors } = useTheme();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;

  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [pendingImages, setPendingImages] = useState<{ id: string; uri: string; fullUrl: string }[]>([]);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ fileId: string; name: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  const {
    sessions, currentSessionId, messages, error,
    allMessages, branchSelections,
    loadSessions, openSession, newSession, deleteSession,
    sendMessage, retryMessage, stopStreaming, selectBranch,
  } = useChatStore();

  // 当前会话(标题栏展示)
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const isStreaming = useChatStore((s) => s.sessionCache[s.currentSessionId ?? '']?.isStreaming ?? false);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 内容尺寸变化(含流式增量)时平滑滚动到底部,替代逐条消息 setTimeout
  const handleContentSizeChange = () => {
    listRef.current?.scrollToEnd({ animated: true });
  };

  // 发送指定文本(输入框发送与快捷指令直发共用)
  const sendText = (msg: string) => {
    const hasPendingImages = pendingImages.length > 0;
    if ((!msg && !hasPendingImages) || isStreaming || !bookId) return;
    haptics.tap();
    setPendingImages([]);
    const attachmentIds = pendingImages.map((p) => p.id);
    if (!currentSessionId) {
      newSession(bookId).then((s) => {
        if (s) sendMessage(bookId, msg, undefined, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch);
      });
      return;
    }
    let parentId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].dbId) { parentId = messages[i].dbId; break; }
    }
    sendMessage(bookId, msg, parentId, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch);
  };

  const handleSend = () => {
    const msg = input.trim();
    if (!msg && pendingImages.length === 0) return;
    setInput('');
    sendText(msg);
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

  // 账单导入:上传 → 由 AI(preview_import 工具)引导预览/确认导入
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
    // replaceAssistantDbId 告知后端删除旧回复并重新生成
    sendMessage(bookId, text, parentId, assistantDbId);
  };

  // 会话抽屉操作(与记一笔弹窗的会话列表形式一致)
  const handleCreateSession = () => {
    if (!bookId) return;
    newSession(bookId);
    setSessionListOpen(false);
    haptics.tap();
  };
  const handleSelectSession = (id: string) => {
    openSession(id);
    setSessionListOpen(false);
    haptics.tap();
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
    // 用户消息:右对齐主色气泡;AI 回复:通栏无气泡,给 Markdown/工具卡更大空间
    if (isUser) {
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 }}>
          <View style={{
            maxWidth: '86%',
            backgroundColor: colors.primary,
            borderRadius: 18,
            borderTopRightRadius: 5,
            paddingHorizontal: 13,
            paddingVertical: 9,
          }}>
            <View style={{ gap: 6 }}>
              {item.attachments && item.attachments.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                  {item.attachments.map((a) => (
                    <Image key={a.id} source={{ uri: a.url }} style={{ width: 116, height: 116, borderRadius: 10 }} />
                  ))}
                </View>
              )}
              {item.blocks.map(renderBlock)}
            </View>
          </View>
        </View>
      );
    }
    return (
      <View style={{ marginBottom: 16 }}>
        <View style={{ gap: 8 }}>{item.blocks.map(renderBlock)}</View>
        {/* 次要信息行:Token 消耗 + 重试(流式结束后才显示) */}
        {!item.isStreaming && (item.usage || item.blocks.some((b) => b.type === 'text')) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, minHeight: 22 }}>
            <UsageBadge usage={item.usage} />
            <View style={{ flex: 1 }} />
            <Pressable hitSlop={10} onPress={() => handleRetry(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: colors.muted }}>
              <RefreshCw size={12} color={colors.mutedForeground} />
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>重试</Text>
            </Pressable>
          </View>
        ) : null}
        {/* 分支版本选择 */}
        {hasBranches && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
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
    );
  };

  const iconBtn = {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.muted,
  };
  // 输入区工具按钮
  const composerBtn = { padding: 3, borderRadius: 8 };

  return (
    // 底色由宿主提供(全局 AI 弹窗 / 记一笔弹窗均为 card 白面),保持整体一色不割裂
    <View style={{ flex: 1 }}>
      {/* 会话工具行:菜单按钮 + 当前会话标题 + 新建 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
        <Pressable onPress={() => setSessionListOpen(true)} style={iconBtn}>
          <List size={16} color={colors.foreground} />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '600' }}>{currentSession?.title ?? 'AI 财务助手'}</Text>
        <Pressable onPress={handleCreateSession} style={iconBtn}>
          <Plus size={16} color={colors.foreground} />
        </Pressable>
        {onClose && (
          <Pressable onPress={onClose} style={iconBtn}>
            <X size={16} color={colors.foreground} />
          </Pressable>
        )}
      </View>

      {/* 消息列表 */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 14 }}
        onContentSizeChange={handleContentSizeChange}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 48, paddingBottom: 24, gap: 8 }}>
            <View style={{ width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.1) }}>
              <Bot size={28} color={colors.primary} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', marginTop: 4 }}>你好，我是 AI 财务助手</Text>
            <Text variant="muted" style={{ fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              可以帮你记账、查流水、分析支出趋势
            </Text>
            {/* 快捷指令:点击直接发送 */}
            <View style={{ alignSelf: 'stretch', paddingHorizontal: 20, marginTop: 14, gap: 9 }}>
              {QUICK_PROMPTS.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => sendText(p)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: alpha(colors.primary, 0.14), backgroundColor: alpha(colors.primary, 0.04) }}
                >
                  <Sparkles size={15} color={colors.primary} />
                  <Text style={{ flex: 1, fontSize: 13.5, color: colors.foreground }}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
      />
      {error ? (
        <Text style={{ color: colors.expense, fontSize: 12, textAlign: 'center', paddingBottom: 4 }}>{error}</Text>
      ) : null}

      {/* 输入区(仿网页组合式输入框:文本框在上,工具行在下,发送靠右) */}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.hairline }}>
        {pendingImages.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8 }}>
            {pendingImages.map((img) => (
              <View key={img.id}>
                <Image source={{ uri: img.uri }} style={{ width: 54, height: 54, borderRadius: 8 }} />
                <Pressable
                  onPress={() => setPendingImages((p) => p.filter((x) => x.id !== img.id))}
                  style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.expense, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, lineHeight: 13 }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 7 }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入消息…"
            placeholderTextColor={colors.mutedForeground}
            style={{ minHeight: 34, maxHeight: 108, color: colors.foreground, fontSize: 14, lineHeight: 19, paddingHorizontal: 2, paddingVertical: 4 }}
            multiline
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Pressable hitSlop={8} onPress={handlePickImage} style={composerBtn}>
              <ImagePlus size={17} color={colors.mutedForeground} />
            </Pressable>
            <Pressable hitSlop={8} onPress={handleImport} style={composerBtn}>
              <FileUp size={17} color={colors.mutedForeground} />
            </Pressable>
            {/* 联网搜索开关(激活态胶囊) */}
            <Pressable
              hitSlop={6}
              onPress={() => setWebSearch((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: webSearch ? alpha(colors.primary, 0.14) : 'transparent' }}
            >
              <Globe size={15} color={webSearch ? colors.primary : colors.mutedForeground} />
              <Text style={{ fontSize: 11.5, color: webSearch ? colors.primary : colors.mutedForeground, fontWeight: webSearch ? '600' : '400' }}>联网</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            {isStreaming ? (
              <Pressable
                onPress={() => stopStreaming()}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 32, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted }}
              >
                <StopCircle size={15} color={colors.foreground} />
                <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>停止</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleSend}
                disabled={!input.trim()}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: input.trim() ? 1 : 0.35 }}
              >
                <Send size={16} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* 会话列表(底部弹层,形式与记一笔弹窗一致) */}
      <FormSheet visible={sessionListOpen} title="会话列表" onClose={() => setSessionListOpen(false)}>
        <Pressable
          onPress={handleCreateSession}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, marginBottom: 12 }}
        >
          <Plus size={15} color={colors.primary} />
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '600' }}>新建会话</Text>
        </Pressable>
        <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
          {sessions.map((s) => {
            const active = s.id === currentSessionId;
            return (
              <Pressable
                key={s.id}
                onPress={() => handleSelectSession(s.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6,
                  backgroundColor: active ? alpha(colors.primary, 0.1) : colors.muted,
                  borderWidth: 1, borderColor: active ? alpha(colors.primary, 0.35) : 'transparent',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: active ? '600' : '400', color: colors.foreground }}>{s.title || '新会话'}</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>{timeAgo(s.updatedAt)}</Text>
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={() => { deleteSession(s.id); haptics.warn(); }}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Trash2 size={15} color={colors.mutedForeground} />
                </Pressable>
              </Pressable>
            );
          })}
          {sessions.length === 0 && (
            <Text variant="muted" style={{ textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>暂无会话</Text>
          )}
        </ScrollView>
      </FormSheet>
    </View>
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
    <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
      共 {usage.totalTokens} tokens
    </Text>
  );
}

// ── 思考块(折叠) ──
function ThinkingBlock({ block }: { block: Extract<MessageBlock, { type: 'thinking' }> }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.muted }}>
        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontWeight: '500' }}>思考过程</Text>
        <Text style={{ fontSize: 10, color: colors.mutedForeground, marginLeft: 'auto' }}>{open ? '收起' : '展开'}</Text>
      </Pressable>
      {open && (
        <View style={{ padding: 10, backgroundColor: alpha(colors.foreground, 0.03) }}>
          <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 18 }}>
            {block.content}
          </Text>
        </View>
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
  const actionBtn = { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' as const, justifyContent: 'center' as const };

  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: alpha(statusColor, 0.4), backgroundColor: alpha(statusColor, 0.06), padding: 10, gap: 8 }}>
      {/* 头部 */}
      <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
        <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: statusColor }}>{name}</Text>
        {status === 'pending' && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>执行中…</Text>}
        {status === 'success' && <Text style={{ fontSize: 10, color: '#22c55e' }}>完成</Text>}
        {status === 'error' && <Text style={{ fontSize: 10, color: colors.expense }}>失败</Text>}
        {status === 'confirming' && <Text style={{ fontSize: 10, color: '#f59e0b' }}>待确认</Text>}
        {toolCall.durationMs != null && <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{toolCall.durationMs}ms</Text>}
      </Pressable>

      {/* 参数(折叠) */}
      {expanded && toolCall.args != null && (
        <Text style={{ fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 11, color: colors.mutedForeground }}>
          {typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args, null, 2)}
        </Text>
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
          {toolCall.preview ? <Text style={{ fontSize: 12, color: colors.foreground, lineHeight: 18 }}>{toolCall.preview}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => confirmAndContinue(bookId, toolCall.toolCallId, true)} style={[actionBtn, { backgroundColor: colors.primary }]}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>确认</Text>
            </Pressable>
            <Pressable onPress={() => confirmAndContinue(bookId, toolCall.toolCallId, false)} style={[actionBtn, { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>拒绝</Text>
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
            <Pressable onPress={() => respondToSuggestion(bookId, toolCall.toolCallId, Object.fromEntries((suggestion?.questions ?? []).map((q) => [q.field, getValue(q.field)])))} style={[actionBtn, { backgroundColor: '#8b5cf6' }]}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>提交</Text>
            </Pressable>
            <Pressable onPress={() => respondToSuggestion(bookId, toolCall.toolCallId, null)} style={[actionBtn, { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>取消</Text>
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
              <Pressable key={b.id} onPress={() => setBookChoice(b.id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: bookChoice === b.id ? '#10b981' : colors.hairline, backgroundColor: bookChoice === b.id ? alpha('#10b981', 0.08) : 'transparent' }}>
                <Text style={{ fontSize: 13 }}>{b.name}</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{b.memberCount} 位成员</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => { if (bookChoice) switchBook(toolCall.toolCallId, bookChoice); }} disabled={!bookChoice} style={[actionBtn, { backgroundColor: '#10b981', opacity: bookChoice ? 1 : 0.4 }]}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>切换到此账本</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
