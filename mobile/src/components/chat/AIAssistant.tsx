import { useEffect, useRef, useState } from 'react';
import { Alert, ActivityIndicator, FlatList, Image, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { AlertTriangle, Bot, Brain, CheckCircle2, ChevronDown, ExternalLink, FileUp, Globe, HelpCircle, ImagePlus, List, Loader2, MessageSquareMore, Plus, RefreshCw, Send, Sparkles, StopCircle, Trash2, Wrench, X, XCircle } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ImageLightbox } from '@/components/ui/AttachmentViewer';
import { useChatStore } from '@/stores/chat';
import { useUIShell } from '@/components/chrome/chrome';
import { uploadImage, uploadImportFile, loadToolNames, getToolDisplayName } from '@/services/chat';
import { getBaseUrl } from '@/services/http';
import type { Message, MessageBlock, ToolCallEntry } from '@homibook/core';
import type { Ledger } from '@/types';

// AI 财务助手聊天主体(可嵌入:AI 弹窗 / 记一笔弹窗 AI tab)
// 复刻 web 端 ChatWindow 能力:流式/Markdown/思考块/工具卡(确认·补充信息·切换账本)/小票上传/账单导入/联网搜索/重试/分支
// 根布局为普通 View flex:1 三段式(会话工具行/消息列表/输入区),由宿主提供弹窗与键盘避让容器

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
  const [webSearch, setWebSearch] = useState(true);
  const [pendingImages, setPendingImages] = useState<{ id: string; uri: string; fullUrl: string; originalFilename: string }[]>([]);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  // 导入弹窗(自定义来源选择,对齐 web DropdownMenu 的支付宝/微信/京东三选项)
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  // 全屏图片预览(待发缩略图 / 消息附件图共用)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const listRef = useRef<FlatList>(null);

  const {
    sessions, currentSessionId, messages, error,
    allMessages, branchSelections,
    loadSessions, openSession, newSession, deleteSession,
    sendMessage, retryMessage, stopStreaming, selectBranch,
  } = useChatStore();

  // 当前会话(标题栏展示)
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  // 服务端返回的附件/图片 url 多为相对路径,统一拼完整地址供 Image 加载;
  // 绝对地址若 host 与当前服务器不一致(如 RN 请求无 Origin 头时后端回退 localhost)则校准到配置的服务器
  const resolveFileUrl = (u: string): string => {
    if (!u) return u;
    const base = getBaseUrl();
    if (!u.startsWith('http')) return `${base}${u.startsWith('/') ? u : `/${u}`}`;
    try {
      if (!base) return u;
      const bu = new URL(base);
      const au = new URL(u);
      if (au.origin !== bu.origin) {
        au.protocol = bu.protocol;
        au.host = bu.host;
      }
      return au.toString();
    } catch {
      return u;
    }
  };
  const isStreaming = useChatStore((s) => s.sessionCache[s.currentSessionId ?? '']?.isStreaming ?? false);

  useEffect(() => {
    loadSessions();
    // 工具显示名称缓存(对齐 web loadToolNames)
    loadToolNames();
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
    // 待发附件快照:ids 给后端,完整信息给本地回显
    const pending = [...pendingImages];
    setPendingImages([]);
    const attachmentIds = pending.map((p) => p.id);
    const localAttachments = hasPendingImages
      ? pending.map((p) => ({ id: p.id, url: p.fullUrl, originalFilename: p.originalFilename }))
      : undefined;
    if (!currentSessionId) {
      newSession(bookId).then((s) => {
        if (s) sendMessage(bookId, msg, undefined, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch, localAttachments);
      });
      return;
    }
    let parentId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].dbId) { parentId = messages[i].dbId; break; }
    }
    sendMessage(bookId, msg, parentId, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch, localAttachments);
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
      const { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync } = await import('expo-image-picker');
      const perm = await requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('需要相册权限'); return; }
      // mediaTypes 用新 API(字符串数组);MediaTypeOptions 已废弃
      const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = asset.fileName || 'receipt.jpg';
      const up = await uploadImage(asset.uri, fileName, asset.mimeType || 'image/jpeg');
      setPendingImages((p) => [...p, { id: up.id, uri: resolveFileUrl(up.fullUrl || up.url), fullUrl: up.fullUrl || up.url, originalFilename: up.originalFilename || fileName }]);
    } catch (e: any) {
      Alert.alert('上传失败', e?.message || '未知错误');
    }
  };

  // 账单导入(csv/excel):选来源 → 上传临时文件 → 自动发送含 fileId 的消息(与 web 端一致,
  // AI 从消息中解析 fileId/source 并调用 preview_import 工具引导预览/确认)
  const SOURCE_LABELS: Record<string, string> = { alipay: '支付宝', wechat: '微信', jd: '京东' };

  const handleImport = async (source: string) => {
    setImportSheetOpen(false);
    try {
      const DocumentPicker = await import('expo-document-picker');
      // 仅允许 csv / excel(web input accept 同规则)
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: [
          'text/csv',
          'application/vnd.ms-excel', // .xls
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        ],
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = asset.name || '账单.csv';
      const up = await uploadImportFile(asset.uri, fileName);
      if (!up?.fileId) throw new Error('服务端未返回文件标识');
      // 发送格式化消息(fileId 进文本,AI 解析后调用 preview_import)
      sendText(`请导入${SOURCE_LABELS[source] ?? source}账单文件\nfileId: ${up.fileId}\nsource: ${source}\n文件名: ${up.filename}`);
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

  const renderBlock = (block: MessageBlock, isUser = false) => {
    switch (block.type) {
      case 'thinking':
        return <ThinkingBlock key={block.id} block={block} />;
      case 'text':
        return block.content.trim()
          ? <MarkdownBody key={block.id} content={block.content} inverted={isUser} />
          : null;
      case 'tool-call':
        return <ToolCard key={block.id} toolCall={block} bookId={bookId} />;
      default:
        return null;
    }
  };

  // 消息气泡基础样式(对齐 web MessageBubble:rounded-2xl + 角部差异化)
  const bubbleBase = {
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
  } as const;
  // 头像(28 方圆角:user 主色/「我」,assistant muted/Bot 图标)
  const avatar = (kind: 'user' | 'ai') => (
    <View style={{
      width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      backgroundColor: kind === 'user' ? colors.primary : colors.muted,
    }}>
      {kind === 'user'
        ? <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>我</Text>
        : <Bot size={15} color={colors.foreground} />}
    </View>
  );

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    // 分支版本:以当前消息为父,找所有子消息(存在多个分支时显示版本选择)
    const parentKey = item.dbId || item.id;
    const childBranches = allMessages.filter((m) => m.parentMessageId === parentKey);
    const hasBranches = childBranches.length > 1;

    if (isUser) {
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
          <View style={{ maxWidth: '82%' }}>
            {/* 用户气泡:主色,右上角收窄(web: rounded-2xl rounded-tr-md) */}
            <View style={[bubbleBase, { backgroundColor: colors.primary, borderTopRightRadius: 5 }]}>
              <View style={{ gap: 6 }}>
                {item.attachments && item.attachments.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                    {item.attachments.map((a, i) => {
                      const full = resolveFileUrl(a.url);
                      return (
                        <Pressable key={a.id} onPress={() => setLightbox({ images: item.attachments!.map((x) => resolveFileUrl(x.url)), index: i })}>
                          <Image source={{ uri: full }} style={{ width: 116, height: 116, borderRadius: 8 }} />
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {item.blocks.map((b) => renderBlock(b, true))}
              </View>
            </View>
          </View>
          {avatar('user')}
        </View>
      );
    }

    const isEmptyStreaming = item.isStreaming && !item.blocks.some((b) => (b.type === 'text' && b.content.trim()) || b.type === 'tool-call' || (b.type === 'thinking' && b.content));
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 16 }}>
        {avatar('ai')}
        <View style={{ flexShrink: 1, maxWidth: '86%', minWidth: '58%' }}>
          {/* AI 气泡:浅灰底,左上角收窄;流式空态显示「思考中...」 */}
          <View style={[bubbleBase, { backgroundColor: alpha(colors.foreground, 0.05), borderTopLeftRadius: 5, alignSelf: isEmptyStreaming ? 'flex-start' : 'stretch' }]}>
            {isEmptyStreaming ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>思考中...</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>{item.blocks.length > 0 ? item.blocks.map((b) => renderBlock(b)) : null}</View>
            )}
          </View>
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
      </View>
    );
  };

  // 顶部工具行按钮(对齐 web outline 风格:透明底 + 细边框)
  const iconBtn = {
    width: 32, height: 32, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const,
    borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent',
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
        // 兜底截断:后端异常信息可能携带大段原始数据,只展示头部关键内容
        <Text style={{ color: colors.expense, fontSize: 12, textAlign: 'center', paddingBottom: 4 }}>
          {error.length > 200 ? `${error.slice(0, 200)}…` : error}
        </Text>
      ) : null}

      {/* 输入区(仿网页组合式输入框:文本框在上,工具行在下,发送靠右) */}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.hairline }}>
        {pendingImages.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8 }}>
            {pendingImages.map((img, i) => (
              <View key={img.id}>
                <Pressable onPress={() => setLightbox({ images: pendingImages.map((x) => x.uri), index: i })}>
                  <Image source={{ uri: img.uri }} style={{ width: 54, height: 54, borderRadius: 8 }} />
                </Pressable>
                <Pressable
                  onPress={() => setPendingImages((p) => p.filter((x) => x.id !== img.id))}
                  hitSlop={6}
                  style={{ position: 'absolute', top: 0, right: 0, width: 20, height: 20, borderRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 8, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={12} color="#fff" />
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
            <Pressable hitSlop={8} onPress={() => setImportSheetOpen(true)} style={composerBtn}>
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
                disabled={!input.trim() && pendingImages.length === 0}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: (input.trim() || pendingImages.length > 0) ? 1 : 0.35 }}
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

      {/* 导入弹窗:自定义来源选择(对齐 web DropdownMenu),选择后打开系统文件选择器 */}
      <FormSheet visible={importSheetOpen} title="导入账单" onClose={() => setImportSheetOpen(false)}>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
          选择账单来源，支持导出的 CSV / XLS / XLSX 文件
        </Text>
        <View style={{ gap: 8 }}>
          {(['alipay', 'wechat', 'jd'] as const).map((src) => {
            const badge: Record<string, { bg: string; ch: string }> = {
              alipay: { bg: '#1677ff', ch: '支' },
              wechat: { bg: '#07c160', ch: '微' },
              jd: { bg: '#e1251b', ch: '京' },
            };
            const b = badge[src];
            return (
              <Pressable
                key={src}
                onPress={() => handleImport(src)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12,
                  backgroundColor: colors.muted,
                }}
              >
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: b.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{b.ch}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{SOURCE_LABELS[src]}账单</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 1 }}>导入对应平台导出的账单明细</Text>
                </View>
                <ChevronDown size={15} color={colors.mutedForeground} style={{ transform: [{ rotate: '-90deg' }] }} />
              </Pressable>
            );
          })}
        </View>
      </FormSheet>

      {/* 全屏图片预览(待发缩略图 / 消息附件图) */}
      {lightbox && (
        <ImageLightbox images={lightbox.images} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </View>
  );
}

// ── Markdown 渲染(react-native-markdown-display) ──
// inverted=true 时渲染于主色用户气泡内,正文用反色(web: text-primary-foreground)
function MarkdownBody({ content, inverted = false }: { content: string; inverted?: boolean }) {
  const { colors } = useTheme();
  const fg = inverted ? (colors.primaryForeground || '#fff') : colors.foreground;
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
    code_inline: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), backgroundColor: inverted ? 'rgba(255,255,255,0.2)' : alpha(colors.primary, 0.1), color: inverted ? fg : colors.primary, paddingHorizontal: 3, borderRadius: 3 },
    code_block: { backgroundColor: inverted ? 'rgba(255,255,255,0.12)' : alpha(colors.foreground, 0.06), padding: 10, borderRadius: 6 },
    fence: { backgroundColor: inverted ? 'rgba(255,255,255,0.12)' : alpha(colors.foreground, 0.06), padding: 10, borderRadius: 6 },
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
        <Brain size={12} color={colors.mutedForeground} />
        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontWeight: '500' }}>思考过程</Text>
        <ChevronDown size={12} color={colors.mutedForeground} style={{ marginLeft: 'auto', transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
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

// ── 工具卡片(复刻 web ToolCallCard:状态语义色/参数折叠/确认预览/建议补充/切换账本/web_search) ──

// 确认预览数据结构(web ConfirmPreview)
type ConfirmPreviewType = 'records-table' | 'record-changes' | 'budget-card' | 'generic';
interface PreviewCell { text: string; highlight?: boolean; color?: 'green' | 'red' }
interface ConfirmPreview {
  type?: ConfirmPreviewType;
  title?: string;
  description?: string;
  columns?: string[];
  rows?: PreviewCell[][];
  changes?: { id: string; date: string; fields: { label: string; before: string; after: string }[] }[];
  budgetFields?: { label: string; value: string }[];
  text?: string;
}

function parsePreview(preview?: string): ConfirmPreview | null {
  if (!preview) return null;
  try { return JSON.parse(preview) as ConfirmPreview; } catch { return null; }
}

// 英文字段名 → 中文(web FIELD_LABELS)
const FIELD_LABELS: Record<string, string> = {
  name: '名称', type: '类型', amount: '金额', date: '日期', remark: '备注', payer: '交易方',
  tags: '标签', cron: '触发时间', active: '启用', id: 'ID', ids: 'ID 列表',
  recurringType: '周期类型', accountId: '账户', toAccountId: '目标账户',
  categoryCode: '分类编码', loanTotalAmount: '贷款总额', loanInterestRate: '年利率',
  loanInterestMethod: '还款方式', loanStartDate: '开始日期', loanTermMonths: '期数',
  currency: '货币', initialBalance: '初始余额', accountNo: '账号', bankName: '银行名称',
  visibility: '可见性', status: '状态', balanceAfter: '调整后余额', year: '年份',
  month: '月份', months: '月份列表', startDate: '开始日期', endDate: '结束日期',
  sourceYear: '源年份', sourceMonth: '源月份', targetMonths: '目标月份',
  bookId: '账本', ownerId: '归属人', generateAll: '生成全部',
};
const fieldLabel = (key: string) => FIELD_LABELS[key] || key;

// generic 确认预览:JSON → 表格数据(web toTableData)
function toTableData(raw: string): { keys: string[]; rows: Record<string, string>[] } | null {
  try {
    const outer = JSON.parse(raw);
    const inner = outer?.text ? (typeof outer.text === 'string' ? JSON.parse(outer.text) : outer.text) : outer;
    if (Array.isArray(inner) && inner.length > 0 && typeof inner[0] === 'object' && inner[0] !== null) {
      const keys = Object.keys(inner[0]);
      return { keys, rows: inner.map((item: any) => Object.fromEntries(keys.map((k) => [k, typeof item[k] === 'object' ? JSON.stringify(item[k]) : String(item[k] ?? '')]))) };
    }
    if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      const keys = Object.keys(inner);
      return { keys, rows: [Object.fromEntries(keys.map((k) => [k, typeof inner[k] === 'object' ? JSON.stringify(inner[k]) : String(inner[k] ?? '')]))] };
    }
    return null;
  } catch { return null; }
}

// 状态语义色(对齐 web:blue/red/amber/green/violet/emerald)
const STATUS_COLORS: Record<string, string> = {
  pending: '#3b82f6',
  error: '#ef4444',
  confirming: '#f59e0b',
  suggesting: '#8b5cf6',
  switching: '#10b981',
  success: '#22c55e',
};

// 横向可滚动简易表格(web Table 等价)
function MiniTable({ columns, rows, aligns, maxHeight }: { columns: string[]; rows: string[][]; aligns?: ('left' | 'right')[]; maxHeight?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden', ...(maxHeight ? { maxHeight } : {}) }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
        <View>
          <View style={{ flexDirection: 'row', backgroundColor: colors.muted }}>
            {columns.map((c, i) => (
              <View key={`${c}-${i}`} style={{ paddingHorizontal: 6, paddingVertical: 4, minWidth: 52 }}>
                <Text style={{ fontSize: 10.5, color: colors.mutedForeground, fontWeight: '600', textAlign: aligns?.[i] ?? 'left' }}>{c}</Text>
              </View>
            ))}
          </View>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.hairline }}>
              {row.map((cell, ci) => (
                <View key={ci} style={{ paddingHorizontal: 6, paddingVertical: 4, minWidth: 52 }}>
                  <Text style={{ fontSize: 10.5, color: colors.foreground, textAlign: aligns?.[ci] ?? 'left' }}>{cell}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function BatchIndicator({ toolCallId }: { toolCallId: string }) {
  const messages = useChatStore((s) => s.messages);
  const remaining = messages.filter((m) => m.role === 'assistant').reduce((acc, m) => acc + m.blocks.filter((b) => b.type === 'tool-call' && (b as ToolCallEntry).status === 'confirming').length, 0);
  if (remaining <= 1) return null;
  return <Text style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>等待全部确认 · 剩余 {remaining} 个</Text>;
}

// 确认预览(记录表格/变更对比/预算卡/通用 JSON 表格)
function ConfirmPreviewView({ preview, submitted, submitting, onConfirm }: {
  preview?: string;
  submitted: boolean;
  submitting: boolean;
  onConfirm: (approved: boolean) => void;
}) {
  const { colors } = useTheme();
  const parsed = parsePreview(preview);
  const cellColor = (c?: 'green' | 'red') => (c === 'green' ? '#16a34a' : c === 'red' ? '#dc2626' : colors.foreground);

  return (
    <View style={{ marginTop: 8, gap: 8 }}>
      {parsed?.title ? <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground }}>{parsed.title}</Text> : null}
      {parsed?.description ? <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>{parsed.description}</Text> : null}

      {/* records-table:表头+高亮/着色单元格 */}
      {parsed?.type === 'records-table' && parsed.columns && parsed.rows && (() => {
        const c = colors;
        return (
          <View style={{ borderRadius: 8, borderWidth: 1, borderColor: c.hairline, overflow: 'hidden', maxHeight: 180 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
              <View>
                <View style={{ flexDirection: 'row', backgroundColor: c.muted }}>
                  {parsed.columns!.map((col, i) => (
                    <View key={`${col}-${i}`} style={{ paddingHorizontal: 6, paddingVertical: 4, minWidth: 52 }}>
                      <Text style={{ fontSize: 10.5, color: c.mutedForeground, fontWeight: '600' }}>{col}</Text>
                    </View>
                  ))}
                </View>
                {parsed.rows!.map((row, ri) => (
                  <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.hairline }}>
                    {row.map((cell, ci) => (
                      <View key={ci} style={{ paddingHorizontal: 6, paddingVertical: 4, minWidth: 52 }}>
                        <Text style={{ fontSize: 10.5, color: cellColor(cell.color), fontWeight: cell.highlight ? '700' : '400' }}>{cell.text}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        );
      })()}

      {/* record-changes:变更对比(前值划线 → 新值) */}
      {parsed?.type === 'record-changes' && parsed.changes?.map((ch) => (
        <View key={ch.id} style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.muted }}>
            <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>ID: {ch.id} | 日期: {ch.date}</Text>
          </View>
          {ch.fields.map((f) => (
            <View key={f.label} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.hairline }}>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground, width: 60 }}>{f.label}</Text>
              <Text style={{ fontSize: 10.5, color: '#dc2626', textDecorationLine: 'line-through', flex: 1 }} numberOfLines={1}>{f.before}</Text>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground, paddingHorizontal: 4 }}>→</Text>
              <Text style={{ fontSize: 10.5, color: '#16a34a', fontWeight: '500', flex: 1 }} numberOfLines={1}>{f.after}</Text>
            </View>
          ))}
        </View>
      ))}

      {/* budget-card:字段列表 */}
      {parsed?.type === 'budget-card' && parsed.budgetFields && (
        <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, padding: 8, gap: 4 }}>
          {parsed.budgetFields.map((f) => (
            <View key={f.label} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground, width: 60 }}>{f.label}</Text>
              <Text style={{ fontSize: 10.5, color: colors.foreground, fontWeight: '500', flex: 1 }}>{f.value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* generic 或解析失败:JSON 表格 */}
      {(!parsed || parsed.type === 'generic') && (() => {
        const table = toTableData(preview || '');
        if (!table) {
          return <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>{preview}</Text>;
        }
        return <MiniTable columns={table.keys.map(fieldLabel)} rows={table.rows.map((r) => table.keys.map((k) => r[k]))} maxHeight={192} />;
      })()}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => onConfirm(true)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: submitted ? 0.6 : 1 }}>
          {submitting && <ActivityIndicator size="small" color="#fff" />}
          <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '600' }}>{submitting ? '提交中...' : '确认'}</Text>
        </Pressable>
        <Pressable onPress={() => onConfirm(false)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, opacity: submitted ? 0.6 : 1 }}>
          <Text style={{ fontSize: 12.5, color: colors.foreground }}>拒绝</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ToolCard({ toolCall, bookId }: { toolCall: ToolCallEntry; bookId: string }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [bookChoice, setBookChoice] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { confirmAndContinue, respondToSuggestion, switchBook } = useChatStore();
  const messages = useChatStore((s) => s.messages);

  const name = getToolDisplayName(toolCall.toolName);
  const args = typeof toolCall.args === 'object' && toolCall.args != null ? toolCall.args as Record<string, unknown> : null;

  // 历史数据 status=pending 时按已有字段推断实际状态(web 同逻辑)
  let effectiveStatus = toolCall.status;
  let isExpired = false;
  let expiredMessage: string | undefined;
  const suggestion = toolCall.suggestion;
  if (toolCall.status === 'pending') {
    if (toolCall.toolName === 'suggest_options') {
      const questions = (toolCall.args as any)?.questions;
      if (questions?.length > 0) { effectiveStatus = 'suggesting'; isExpired = true; }
    } else if (toolCall.toolName === 'switch_book') {
      const books = (toolCall.result as any)?.books;
      if (books?.length > 0) { effectiveStatus = 'switching'; isExpired = true; expiredMessage = '切换操作已过期，请重新发起'; }
    } else if (toolCall.result != null) {
      effectiveStatus = 'success';
    } else if (toolCall.preview) {
      effectiveStatus = 'confirming'; isExpired = true;
    } else if (toolCall.toolName === 'preview_import' && (toolCall.args as any)?.mode === 'preview') {
      effectiveStatus = 'error'; isExpired = true; expiredMessage = '导入预览数据已过期，请重新上传文件发起导入';
    } else if (toolCall.toolName === 'confirm_import') {
      effectiveStatus = 'error'; isExpired = true; expiredMessage = '导入确认已过期，请重新发起导入';
    }
  }

  const isInteractivePreview = toolCall.toolName === 'preview_import' && args?.mode === 'preview';
  const confirmResult = toolCall.toolName === 'confirm_import' && effectiveStatus === 'success' ? ((toolCall.result as any)?.data ?? null) : null;
  const isConfirmCard = confirmResult && (confirmResult.mode === 'confirm_preview' || confirmResult.imported != null);
  const isImportPending = isInteractivePreview && effectiveStatus === 'success' && !(toolCall.result as any)?.data?.confirmed;

  const color = STATUS_COLORS[effectiveStatus] ?? colors.primary;
  const StatusIcon =
    effectiveStatus === 'pending' ? Loader2
    : isImportPending ? HelpCircle
    : effectiveStatus === 'success' ? CheckCircle2
    : effectiveStatus === 'error' ? XCircle
    : effectiveStatus === 'confirming' ? HelpCircle
    : effectiveStatus === 'suggesting' ? MessageSquareMore
    : HelpCircle;

  const showArgs = toolCall.args != null;
  const showResult = effectiveStatus === 'success' && toolCall.result != null;
  const showError = effectiveStatus === 'error';

  const handleConfirm = (approved: boolean) => {
    if (submitted) return;
    setSubmitted(true);
    confirmAndContinue(bookId, toolCall.toolCallId, approved);
  };

  const getValue = (field: string) => {
    const sel = selected[field];
    if (!sel) return '';
    return sel === '__custom__' ? (custom[field] || '').trim() : sel;
  };
  const suggestionQuestions = suggestion?.questions;
  const allFilled = (suggestionQuestions ?? []).every((q) => !!getValue(q.field));

  const btnText = { fontSize: 12.5, fontWeight: '600' as const };

  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: alpha(color, 0.35), backgroundColor: alpha(color, 0.07), paddingHorizontal: 10, paddingVertical: 8, gap: 6 }}>
      {/* 可点击头部:状态图标 + 工具名 + 耗时 + 展开 */}
      <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {effectiveStatus === 'pending'
          ? <Loader2 size={14} color={color} />
          : <StatusIcon size={14} color={color} />}
        <Wrench size={13} color={colors.mutedForeground} />
        <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>{name}</Text>
        {toolCall.durationMs != null && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{toolCall.durationMs}ms</Text>}
        {showArgs && <ChevronDown size={12} color={colors.mutedForeground} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />}
      </Pressable>

      {/* 参数折叠 */}
      {expanded && showArgs && (
        <View>
          <Text style={{ fontSize: 9.5, textTransform: 'uppercase', color: colors.mutedForeground, letterSpacing: 0.5 }}>参数</Text>
          <View style={{ backgroundColor: colors.card, borderRadius: 6, padding: 6, marginTop: 2, maxHeight: 96, overflow: 'hidden' }}>
            <Text style={{ fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 10.5, color: colors.mutedForeground }}>
              {typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args, null, 2)}
            </Text>
          </View>
        </View>
      )}

      {/* 错误信息(始终可见) */}
      {showError && (
        <Text style={{ fontSize: 11.5, color: '#dc2626' }}>
          {typeof toolCall.result === 'object' && (toolCall.result as any)?.error ? (toolCall.result as any).error : '执行失败'}
        </Text>
      )}

      {/* web_search 结果(展开时) */}
      {toolCall.toolName === 'web_search' && showResult && expanded && (
        <View style={{ gap: 6 }}>
          {(() => {
            const data = (toolCall.result as any)?.data;
            if (!data?.results?.length) return <Text style={{ fontSize: 11, color: colors.mutedForeground }}>无搜索结果</Text>;
            return data.results.map((r: any, i: number) => (
              <Pressable key={i} onPress={() => { Linking.openURL(r.url).catch(() => {}); }} style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.card, padding: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                  <ExternalLink size={11} color="#2563eb" style={{ marginTop: 2 }} />
                  <Text style={{ flex: 1, fontSize: 11.5, fontWeight: '500', color: '#2563eb' }}>{r.title}</Text>
                </View>
                {r.snippet ? <Text numberOfLines={2} style={{ fontSize: 10.5, color: colors.mutedForeground, marginTop: 3 }}>{r.snippet}</Text> : null}
              </Pressable>
            ));
          })()}
        </View>
      )}

      {/* 其他工具结果(折叠内) */}
      {!isInteractivePreview && !isConfirmCard && toolCall.toolName !== 'web_search' && showResult && expanded && (
        <View>
          <Text style={{ fontSize: 9.5, textTransform: 'uppercase', color: colors.mutedForeground, letterSpacing: 0.5 }}>结果</Text>
          <Text style={{ fontSize: 10.5, color: colors.mutedForeground, marginTop: 2 }}>
            {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
          </Text>
        </View>
      )}

      {/* preview_import 预览模式结果(简版展示;完整映射交互卡后续复刻) */}
      {isInteractivePreview && showResult && (
        <View style={{ marginTop: 2 }}>
          {(() => {
            const table = toTableData(JSON.stringify((toolCall.result as any)?.data ?? toolCall.result));
            if (!table) return null;
            return <MiniTable columns={table.keys.map(fieldLabel)} rows={table.rows.map((r) => table.keys.map((k) => r[k]))} maxHeight={192} />;
          })()}
        </View>
      )}

      {/* confirm_import 结果卡(简版复刻 web ImportConfirmCard) */}
      {isConfirmCard && showResult && (() => {
        const data = confirmResult as any;
        if (data.mode !== 'confirm_preview') {
          // 导入完成结果
          return (
            <View style={{ borderRadius: 8, borderWidth: 1, borderColor: alpha('#22c55e', 0.35), backgroundColor: alpha('#22c55e', 0.1), padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <CheckCircle2 size={14} color="#22c55e" />
              <Text style={{ fontSize: 11.5, color: colors.foreground }}>
                已导入 <Text style={{ fontWeight: '700' }}>{data.imported}</Text> 条记录{data.accountsCreated ? `，新建 ${data.accountsCreated} 个账户` : ''}
              </Text>
            </View>
          );
        }
        const sourceLabels: Record<string, string> = { alipay: '支付宝', wechat: '微信', jd: '京东' };
        return (
          <View style={{ marginTop: 2, gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[sourceLabels[data.source] || data.source, `${data.stats?.totalRecords ?? 0} 条记录`, `收入 ${data.stats?.incomeCount ?? 0}`, `支出 ${data.stats?.expenseCount ?? 0}`]
                .concat(data.stats?.transferCount > 0 ? [`转账 ${data.stats.transferCount}`] : [])
                .concat(data.stats?.accountsToCreate > 0 ? [`新增 ${data.stats.accountsToCreate} 个账户`] : [])
                .map((t, i) => (
                  <View key={i} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.muted }}>
                    <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>{t}</Text>
                  </View>
                ))}
            </View>
            {data.records?.length > 0 && (
              <MiniTable
                columns={['#', '日期', '类型', '金额', '账户', '分类', '说明']}
                rows={data.records.slice(0, 50).map((r: any) => [String(r.rowIndex), r.date, r.type, (r.amount ?? 0).toFixed(2), r.accountName, r.categoryLabel || r.categoryCode || '-', r.remark || '-'])}
                maxHeight={220}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => confirmAndContinue(data.accountBookId || bookId, toolCall.toolCallId, true, { fileId: data.fileId, ownerId: data.ownerId })} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: submitted ? 0.6 : 1 }}>
                {submitted && <ActivityIndicator size="small" color="#fff" />}
                <Text style={{ color: '#fff', ...btnText }}>{submitted ? '提交中...' : `确认导入 ${data.stats?.totalRecords ?? 0} 条记录`}</Text>
              </Pressable>
              <Pressable onPress={() => confirmAndContinue(data.accountBookId || bookId, toolCall.toolCallId, false)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, opacity: submitted ? 0.6 : 1 }}>
                <Text style={{ fontSize: 12.5, color: colors.foreground }}>取消</Text>
              </Pressable>
            </View>
          </View>
        );
      })()}

      {/* 历史数据过期提示(始终可见) */}
      {isExpired && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <AlertTriangle size={12} color={effectiveStatus === 'error' ? '#dc2626' : '#f59e0b'} />
          <Text style={{ fontSize: 10.5, color: effectiveStatus === 'error' ? '#dc2626' : '#f59e0b', flex: 1 }}>
            {expiredMessage || '此操作在重新加载后已过期，请重新发起请求'}
          </Text>
        </View>
      )}

      {/* 批量确认计数 */}
      {effectiveStatus === 'confirming' && <BatchIndicator toolCallId={toolCall.toolCallId} />}

      {/* 确认按钮(始终可见) */}
      {(effectiveStatus === 'confirming' || (isExpired && toolCall.preview)) && (
        <ConfirmPreviewView preview={toolCall.preview} submitted={submitted} submitting={submitted} onConfirm={handleConfirm} />
      )}

      {/* 建议补充(始终可见) */}
      {effectiveStatus === 'suggesting' && suggestionQuestions && (
        <View style={{ marginTop: 4, gap: 10 }}>
          {suggestionQuestions.map((q, qi) => {
            const sel = selected[q.field] || '';
            return (
              <View key={q.field} style={{ gap: 6 }}>
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.foreground }}>
                  {suggestionQuestions.length > 1 && <Text style={{ color: colors.mutedForeground }}>{qi + 1}. </Text>}{q.question}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {q.options.map((opt) => {
                    const label = typeof opt === 'string' ? opt : (opt?.label || opt?.name || opt?.description || JSON.stringify(opt));
                    const value = typeof opt === 'string' ? opt : (opt?.value || opt?.code || label);
                    const active = sel === value;
                    return (
                      <Pressable key={value} onPress={() => setSelected((p) => ({ ...p, [q.field]: value }))} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: active ? colors.primary : 'transparent', borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
                        <Text style={{ fontSize: 11.5, color: active ? '#fff' : colors.foreground }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                  {q.allowCustom && (
                    <Pressable onPress={() => setSelected((p) => ({ ...p, [q.field]: '__custom__' }))} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: sel === '__custom__' ? colors.primary : 'transparent', borderWidth: 1, borderColor: sel === '__custom__' ? colors.primary : colors.border }}>
                      <Text style={{ fontSize: 11.5, color: sel === '__custom__' ? '#fff' : colors.foreground }}>自定义</Text>
                    </Pressable>
                  )}
                </View>
                {sel === '__custom__' && (
                  <TextInput
                    value={custom[q.field] || ''}
                    onChangeText={(t) => setCustom((p) => ({ ...p, [q.field]: t }))}
                    placeholder="输入自定义内容..."
                    placeholderTextColor={colors.mutedForeground}
                    style={{ borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11.5, color: colors.foreground }}
                  />
                )}
              </View>
            );
          })}
          {isExpired && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <AlertTriangle size={12} color="#f59e0b" />
              <Text style={{ fontSize: 10.5, color: '#f59e0b', flex: 1 }}>此操作在重新加载后已过期，请在聊天输入框中直接回复你的选择</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => { if (!allFilled || submitted) return; setSubmitted(true); respondToSuggestion(bookId, toolCall.toolCallId, Object.fromEntries((suggestionQuestions ?? []).map((q) => [q.field, getValue(q.field)]))); }}
              disabled={!allFilled || submitted}
              style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: (!allFilled || submitted) ? 0.5 : 1 }}
            >
              {submitted && <ActivityIndicator size="small" color="#fff" />}
              <Text style={{ color: '#fff', ...btnText }}>{submitted ? '提交中...' : '提交'}</Text>
            </Pressable>
            <Pressable onPress={() => respondToSuggestion(bookId, toolCall.toolCallId, null)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', opacity: submitted ? 0.6 : 1 }}>
              <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>取消</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 切换账本(始终可见) */}
      {effectiveStatus === 'switching' && (
        <View style={{ marginTop: 4, gap: 8 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.foreground }}>选择要切换的账本：</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {((toolCall.result as any)?.books ?? []).map((b: Ledger) => {
              const active = bookChoice === b.id;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setBookChoice(b.id)}
                  style={{ width: 150, borderRadius: 10, borderWidth: 1, padding: 10, borderColor: active ? '#10b981' : colors.hairline, backgroundColor: active ? alpha('#10b981', 0.08) : colors.card }}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>{b.name}</Text>
                  <Text style={{ fontSize: 10.5, color: colors.mutedForeground, marginTop: 2 }}>{b.memberCount} 位成员</Text>
                </Pressable>
              );
            })}
          </View>
          {isExpired && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <AlertTriangle size={12} color="#f59e0b" />
              <Text style={{ fontSize: 10.5, color: '#f59e0b', flex: 1 }}>切换操作已过期，请在聊天输入框中直接说明要切换的账本</Text>
            </View>
          )}
          <Pressable
            onPress={() => { if (bookChoice) { setSubmitted(true); switchBook(toolCall.toolCallId, bookChoice); } }}
            disabled={!bookChoice}
            style={{ borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: '#10b981', opacity: !bookChoice ? 0.5 : 1 }}
          >
            <Text style={{ color: '#fff', ...btnText }}>切换到此账本</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
