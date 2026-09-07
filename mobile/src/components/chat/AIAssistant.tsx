import { useEffect, useRef, useState } from 'react';
import { Alert, ActivityIndicator, FlatList, Image, Linking, Platform, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { AlertTriangle, Bot, Brain, CheckCircle2, ChevronDown, Copy, ExternalLink, FileSpreadsheet, FileText, FileUp, Globe, HelpCircle, ImagePlus, List, Loader2, MessageSquareMore, Plus, RefreshCw, Search, Send, Sparkles, StopCircle, Trash2, Wrench, X, XCircle } from 'lucide-react-native';
import { useTheme, alpha, haptics, semanticTypeColor } from '@/theme';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ImageLightbox, isImageUrl } from '@/components/ui/AttachmentViewer';
import { useChatStore, useSessionView } from '@/stores/chat';
import { useUIShell } from '@/components/chrome/chrome';
import { uploadImage, loadToolNames, getToolDisplayName } from '@/services/chat';
import { uploadImportTempFile } from '@/services/import';
import { DownloadModeSheet } from '@/components/chrome/DownloadModeSheet';
import { downloadAttachment, resolveRemoteUrl, type DownloadMode } from '@/services/http';
import type { Message, MessageBlock, ToolCallEntry } from '@homibook/core';
import { ACCOUNT_TYPE_LABELS, TYPE_TO_GROUP, IMPORT_SOURCE_LABELS, buildImportMessage, initAccountResolutions, parseImportMessage, resolveToolCallStatus, unresolvedAccountCount, type AccountResolution } from '@homibook/core';
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
    sessions, currentSessionId, error,
    loadSessions, openSession, newSession, deleteSession,
    sendMessage, retryMessage, stopStreaming, selectBranch,
  } = useChatStore();
  // 当前会话消息视图(活跃路径按分支选择派生,单一数据源在 sessionCache)
  const { messages, allMessages, branchSelections } = useSessionView();

  // 当前会话(标题栏展示)
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  // 服务端返回的附件/图片 url 多为相对路径,统一转完整地址(含 host 校准,见 http.resolveRemoteUrl)
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

  // 选择并上传小票图片(仅图片,同 web 端 accept="image/*";流水附件上传才支持全部文件)
  const handlePickFile = async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: 'image/*',
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = asset.name || 'attachment';
      // 直接上传选择器返回的文件(File.upload 原生 IO 可读;复制到原名文件会触发权限限制)
      // 注:后端 originalFilename 取 multipart filename(cache 随机 id + 原扩展名),本地回显用选择器原名
      const up = await uploadImage(asset.uri, fileName, asset.mimeType || 'application/octet-stream');
      setPendingImages((p) => [...p, { id: up.id, uri: resolveRemoteUrl(up.fullUrl || up.url), fullUrl: up.fullUrl || up.url, originalFilename: fileName }]);
    } catch (e: any) {
      Alert.alert('上传失败', e?.message || '未知错误');
    }
  };

  // 下载非图片附件:先弹保存方式选择(保存到设备/系统分享)
  const [dlTarget, setDlTarget] = useState<{ path: string; name: string } | null>(null);
  const handleDownloadAttachment = (url: string, name: string) => setDlTarget({ path: url, name });
  const runDownload = async (mode: DownloadMode) => {
    const t = dlTarget;
    if (!t) return;
    setDlTarget(null);
    try {
      await downloadAttachment(t.path, t.name, mode);
    } catch (e: any) {
      Alert.alert('下载失败', e?.message || '未知错误');
    }
  };

  // 账单导入(csv/excel):选来源 → 上传临时文件 → 自动发送含 fileId 的消息(与 web 端一致,
  // AI 从消息中解析 fileId/source 并调用 preview_import 工具引导预览/确认)
  // 来源标签统一来自 core IMPORT_SOURCE_LABELS

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
      const up = await uploadImportTempFile(asset.uri, fileName);
      if (!up?.fileId) throw new Error('服务端未返回文件标识');
      // 发送格式化消息(fileId 进文本,AI 解析后调用 preview_import)
      sendText(buildImportMessage({ fileId: up.fileId, source, fileName: up.filename }));
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
      case 'text': {
        if (!block.content.trim()) return null;
        // 导入消息:fileId/source/文件名 元数据行渲染为文件卡片,仅保留描述文本
        if (isUser) {
          const meta = parseImportMessage(block.content);
          if (meta) {
            return (
              <View key={block.id} style={{ gap: 6 }}>
                {meta.desc ? <MarkdownBody content={meta.desc} inverted /> : null}
                <ImportFileCard fileName={meta.fileName} source={meta.source} />
              </View>
            );
          }
        }
        return <MarkdownBody key={block.id} content={block.content} inverted={isUser} />;
      }
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
                    {(() => {
                      const atts = item.attachments!;
                      const imgAtts = atts.filter((x) => isImageUrl(x.url));
                      const imgUrls = imgAtts.map((x) => resolveRemoteUrl(x.url));
                      return atts.map((a) => {
                        // 非图片附件:文件名块,点击下载
                        if (!isImageUrl(a.url)) {
                          return (
                            <Pressable
                              key={a.id}
                              onPress={() => handleDownloadAttachment(a.url, a.originalFilename)}
                              style={{ width: 132, minHeight: 76, borderRadius: 8, backgroundColor: alpha(colors.foreground, 0.12), alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6 }}
                            >
                              <FileText size={18} color={colors.foreground} />
                              <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.foreground, maxWidth: '100%' }}>{a.originalFilename}</Text>
                            </Pressable>
                          );
                        }
                        // 图片附件:缩略图,点击进全屏预览(仅在图片集合内翻页)
                        const idx = imgAtts.findIndex((x) => x.id === a.id);
                        return (
                          <Pressable key={a.id} onPress={() => setLightbox({ images: imgUrls, index: idx })}>
                            <Image source={{ uri: resolveRemoteUrl(a.url) }} style={{ width: 116, height: 116, borderRadius: 8 }} />
                          </Pressable>
                        );
                      });
                    })()}
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
            {(() => {
              const imgUrls = pendingImages.filter((x) => isImageUrl(x.uri)).map((x) => x.uri);
              return pendingImages.map((img) => (
                <View key={img.id}>
                  {isImageUrl(img.uri) ? (
                    <Pressable onPress={() => setLightbox({ images: imgUrls, index: imgUrls.indexOf(img.uri) })}>
                      <Image source={{ uri: img.uri }} style={{ width: 54, height: 54, borderRadius: 8 }} />
                    </Pressable>
                  ) : (
                    <View style={{ width: 54, height: 54, borderRadius: 8, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 3 }}>
                      <FileText size={16} color={colors.mutedForeground} />
                      <Text numberOfLines={1} style={{ fontSize: 8, color: colors.mutedForeground, maxWidth: '100%' }}>{img.originalFilename}</Text>
                    </View>
                  )}
                  <Pressable
                    onPress={() => setPendingImages((p) => p.filter((x) => x.id !== img.id))}
                    hitSlop={6}
                    style={{ position: 'absolute', top: 0, right: 0, width: 20, height: 20, borderRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 8, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={12} color="#fff" />
                  </Pressable>
                </View>
              ));
            })()}
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
            <Pressable hitSlop={8} onPress={handlePickFile} style={composerBtn}>
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
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{IMPORT_SOURCE_LABELS[src]}账单</Text>
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

      {/* 非图片附件保存方式选择(保存到设备/系统分享) */}
      <DownloadModeSheet visible={!!dlTarget} title="保存附件" onMode={runDownload} onClose={() => setDlTarget(null)} />
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

// 拆分出的子组件(工具卡/导入预览卡)
import { BatchIndicator, ToolCard } from './ToolCard';
import { ImportFileCard, ImportPreviewCard } from './ImportPreviewCard';
