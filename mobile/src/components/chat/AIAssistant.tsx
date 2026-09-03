import { useEffect, useRef, useState } from 'react';
import { Alert, ActivityIndicator, FlatList, Image, Linking, Platform, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { AlertTriangle, Bot, Brain, CheckCircle2, ChevronDown, Copy, ExternalLink, FileSpreadsheet, FileText, FileUp, Globe, HelpCircle, ImagePlus, List, Loader2, MessageSquareMore, Plus, RefreshCw, Search, Send, Sparkles, StopCircle, Trash2, Wrench, X, XCircle } from 'lucide-react-native';
import { useTheme, alpha, haptics, semanticTypeColor } from '@/theme';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ImageLightbox, isImageUrl } from '@/components/ui/AttachmentViewer';
import { useChatStore } from '@/stores/chat';
import { useUIShell } from '@/components/chrome/chrome';
import { uploadImage, uploadImportFile, loadToolNames, getToolDisplayName } from '@/services/chat';
import { DownloadModeSheet } from '@/components/chrome/DownloadModeSheet';
import { downloadAttachment, getBaseUrl, type DownloadMode } from '@/services/http';
import type { Message, MessageBlock, ToolCallEntry } from '@homibook/core';
import { ACCOUNT_TYPE_LABELS } from '@homibook/core';
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
      setPendingImages((p) => [...p, { id: up.id, uri: resolveFileUrl(up.fullUrl || up.url), fullUrl: up.fullUrl || up.url, originalFilename: fileName }]);
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
      case 'text': {
        if (!block.content.trim()) return null;
        // 导入消息:fileId/source/文件名 元数据行渲染为文件卡片,仅保留描述文本
        if (isUser) {
          const meta = parseImportMeta(block.content);
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
                      const imgUrls = imgAtts.map((x) => resolveFileUrl(x.url));
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
                            <Image source={{ uri: resolveFileUrl(a.url) }} style={{ width: 116, height: 116, borderRadius: 8 }} />
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

// 按内容估算统一列宽:取全部行(含表头)该列的最大文本宽(全角 1 / 半角 0.55 折算),
// 上下限截断后作为固定 width 应用到每一行,保证列对齐(各行列宽一致,长文本单行截断)
function computeColWidths(rows: readonly (readonly string[])[], colCount: number, maxW = 150): number[] {
  const charUnit = 10.5; // fontSize 10.5 全角字符近似宽
  return Array.from({ length: colCount }, (_, ci) => {
    let maxUnits = 0;
    for (const row of rows) {
      let units = 0;
      for (const ch of row[ci] ?? '') units += ch.charCodeAt(0) > 255 ? 1 : 0.55;
      if (units > maxUnits) maxUnits = units;
    }
    return Math.max(44, Math.min(Math.ceil(maxUnits * charUnit) + 13, maxW));
  });
}

// 横向可滚动简易表格(web Table 等价)
function MiniTable({ columns, rows, aligns, maxHeight }: { columns: string[]; rows: string[][]; aligns?: ('left' | 'right')[]; maxHeight?: number }) {
  const { colors } = useTheme();
  // 列宽 = 表头 + 全部单元格按内容统一计算(行长短不一不再错位)
  const colWidths = computeColWidths([columns, ...rows], columns.length);
  return (
    <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden', ...(maxHeight ? { maxHeight } : {}) }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
        <View>
          <View style={{ flexDirection: 'row', backgroundColor: colors.muted }}>
            {columns.map((c, i) => (
              <View key={`${c}-${i}`} style={{ width: colWidths[i], paddingHorizontal: 6, paddingVertical: 4 }}>
                <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.mutedForeground, fontWeight: '600', textAlign: aligns?.[i] ?? 'left' }}>{c}</Text>
              </View>
            ))}
          </View>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.hairline }}>
              {row.map((cell, ci) => (
                <View key={ci} style={{ width: colWidths[ci], paddingHorizontal: 6, paddingVertical: 4 }}>
                  <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.foreground, textAlign: aligns?.[ci] ?? 'left' }}>{cell}</Text>
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
  // 待决定状态:confirming(待确认)/suggesting(待选择)/switching(待选账本)
  const remaining = messages.filter((m) => m.role === 'assistant').reduce((acc, m) => acc + m.blocks.filter((b) => b.type === 'tool-call' && ['confirming', 'suggesting', 'switching'].includes((b as ToolCallEntry).status)).length, 0);
  if (remaining <= 1) return null;
  return <Text style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>等待全部确认 · 剩余 {remaining} 个</Text>;
}

// ── 导入消息文件卡片:把"请导入XX账单文件/fileId/source/文件名"文本渲染为附件卡片 ──

const IMPORT_SOURCE_LABELS: Record<string, string> = { alipay: '支付宝', wechat: '微信', jd: '京东' };

/** 解析导入消息文本(发送时为 AI 解析拼接的元数据行,渲染时转为文件卡片) */
function parseImportMeta(text: string): { desc: string; fileName: string; source: string } | null {
  const m = text.match(/^([\s\S]*?)\s*\nfileId:\s*(\S+)\s*\nsource:\s*(\S+)\s*\n文件名:\s*(.+?)\s*$/);
  if (!m) return null;
  return { desc: m[1].trim(), fileName: m[4], source: IMPORT_SOURCE_LABELS[m[3]] ?? m[3] };
}

/** 导入账单文件卡片(用户主色气泡内:白色半透明底) */
function ImportFileCard({ fileName, source }: { fileName: string; source: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: alpha('#ffffff', 0.18), borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 }}>
      <View style={{ width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha('#ffffff', 0.22) }}>
        <FileSpreadsheet size={18} color="#fff" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>{fileName}</Text>
        <Text style={{ fontSize: 10.5, color: alpha('#ffffff', 0.75), marginTop: 1 }}>{source}账单 · 待导入</Text>
      </View>
    </View>
  );
}

// ── 导入预览交互卡(复刻 web ImportPreviewInteractive,UI 适配移动端) ──

const IMPORT_TYPE_LABELS: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账', UNKNOWN: '未知' };
const IMPORT_TYPE_TO_GROUP: Record<string, string> = {
  EXPENSE: 'transaction_category_expense',
  INCOME: 'transaction_category_income',
  TRANSFER: 'transaction_category_transfer',
};
const IMPORT_GROUP_HEADING: Record<string, string> = {
  transaction_category_expense: '支出分类',
  transaction_category_income: '收入分类',
  transaction_category_transfer: '转账分类',
};

// 分类字典项(与 web ImportPreviewData.allDictItems 同构)
interface ImportDictEntry { code: string; label: string; group: string }

function ImportPreviewCard({ toolCall, bookId }: { toolCall: ToolCallEntry; bookId: string }) {
  const { colors } = useTheme();
  const { confirmAndContinue } = useChatStore();
  const [tab, setTab] = useState<'records' | 'accounts' | 'categories' | 'unrec'>('records');
  const [submitted, setSubmitted] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  // 账户解析:同一 csvName → 新建(名称+类型) 或 映射已有账户
  type AccountResolution = { action: 'create'; name: string; type: string } | { action: 'existing'; accountId: string };
  const [accountRes, setAccountRes] = useState<Record<string, AccountResolution>>({});
  // 分类解析规则(可复制成多条,带正则条件与保存开关)
  interface CategoryResolution { id: string; sourceCategory: string; type: string; targetCode: string; save: boolean; payerContains: string; descriptionContains: string }
  const [categoryRes, setCategoryRes] = useState<CategoryResolution[]>([]);
  // 未识别记录的手动指定
  const [unrecRes, setUnrecRes] = useState<Record<number, { type: string; accountId: string; categoryCode: string }>>({});
  // 底部选择弹窗(FormSheet)
  const [picker, setPicker] = useState<null | { kind: 'acct-existing' | 'acct-type' | 'cat-target' | 'unrec-type' | 'unrec-acct' | 'unrec-cat'; key: string; type?: string }>(null);
  const [catSearch, setCatSearch] = useState('');

  const data = (toolCall.result as any)?.data ?? toolCall.result ?? {};
  const aiArgs = (toolCall.args ?? {}) as any;
  const records: any[] = data.records ?? [];
  const unrec: any[] = data.unrecognizedRecords ?? [];
  const unmatchedAccounts: any[] = data.unmatchedAccounts ?? [];
  const accounts: { id: string; name: string; type: string; ownerId?: string; ownerName?: string }[] = data.accounts ?? [];
  const multiOwnerAccounts = isMultiOwnerAccounts(accounts);
  const dictItems: ImportDictEntry[] = data.allDictItems ?? [];
  const stats = data.stats;
  const isConfirmed = !!data.confirmed;
  const accountBookId: string = data.accountBookId || bookId;

  // 初始化解析默认值(web 同逻辑:AI 决议 → 候选首位 → 新建建议)
  useEffect(() => {
    const acct: Record<string, AccountResolution> = {};
    for (const ua of unmatchedAccounts) {
      const ar = ua.aiResolution;
      if (ar?.action === 'existing' && ar.targetAccountId) {
        acct[ua.csvName] = { action: 'existing', accountId: ar.targetAccountId };
      } else if (ar?.action === 'create' && ar.targetAccountName && ar.accountType) {
        acct[ua.csvName] = { action: 'create', name: ar.targetAccountName, type: ar.accountType };
      } else if (ua.candidates?.length) {
        acct[ua.csvName] = { action: 'existing', accountId: ua.candidates[0].id };
      } else {
        acct[ua.csvName] = { action: 'create', name: ua.suggestedName, type: ua.suggestedType };
      }
    }
    // AI 参数中的账户映射回显(覆盖默认值)
    for (const ar of aiArgs.accountResolutions ?? []) {
      if (ar.action === 'existing' && ar.targetAccountId) {
        acct[ar.sourceAccountName] = { action: 'existing', accountId: ar.targetAccountId };
      } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
        acct[ar.sourceAccountName] = { action: 'create', name: ar.targetAccountName, type: ar.accountType };
      }
    }
    setAccountRes(acct);

    setCategoryRes(
      (data.unmatchedCategories ?? [])
        .filter((uc: any) => uc.aiRecordType || uc.types?.[0])
        .map((uc: any, i: number) => ({
          id: String(i),
          sourceCategory: uc.sourceCategory,
          type: uc.aiRecordType || uc.types?.[0] || '',
          targetCode: uc.suggestedCode || '',
          save: true,
          payerContains: uc.payerContains || '',
          descriptionContains: uc.descriptionContains || '',
        })),
    );

    const unres: Record<number, { type: string; accountId: string; categoryCode: string }> = {};
    for (const r of unrec) {
      unres[r.rowIndex] = { type: '', accountId: r.accountId || accounts[0]?.id || '', categoryCode: r.mappedCategoryCode || r.categoryCode || '' };
    }
    setUnrecRes(unres);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 后端确认成功(data.confirmed=true)后复位提交标记,按钮切换为「已确认」
  useEffect(() => {
    if (isConfirmed) setSubmitted(false);
  }, [isConfirmed]);

  const unresolvedAcctCount = unmatchedAccounts.filter((ua) => {
    const res = accountRes[ua.csvName];
    return res && (res.action === 'existing' ? !res.accountId : !res.name);
  }).length;
  const unresolvedCatCount = categoryRes.filter((cr) => !cr.targetCode).length;
  const unresolvedUnrecCount = unrec.filter((r) => {
    const res = unrecRes[r.rowIndex];
    return !res?.type || !res?.accountId;
  }).length;

  const allRecords = [...records, ...unrec];
  const tabs = [
    { key: 'records' as const, label: `记录 (${allRecords.length})` },
    { key: 'accounts' as const, label: `未匹配账户 (${unmatchedAccounts.length})` },
    { key: 'categories' as const, label: `未匹配分类 (${categoryRes.length})` },
    { key: 'unrec' as const, label: `需处理 (${unrec.length})` },
  ];

  // 分类候选:按记录类型过滤字典 + 搜索
  const filteredDict = (type: string) => {
    const group = IMPORT_TYPE_TO_GROUP[type];
    const items = group ? dictItems.filter((d) => d.group === group) : dictItems;
    if (!catSearch) return items;
    const s = catSearch.toLowerCase();
    return items.filter((d) => d.label.toLowerCase().includes(s) || d.code.toLowerCase().includes(s));
  };
  const groupedDict = (type: string) => {
    const groups = new Map<string, ImportDictEntry[]>();
    for (const d of filteredDict(type)) {
      const list = groups.get(d.group) ?? [];
      list.push(d);
      groups.set(d.group, list);
    }
    return groups;
  };

  // ── 选择弹窗内容 ──
  const pickerTitle =
    picker?.kind === 'acct-existing' ? '选择已有账户'
    : picker?.kind === 'acct-type' ? '账户类型'
    : picker?.kind === 'cat-target' ? '选择目标分类'
    : picker?.kind === 'unrec-type' ? '记录类型'
    : picker?.kind === 'unrec-acct' ? '选择账户'
    : '选择分类';
  const pickerOptions: { value: string; label: string }[] = (() => {
    if (!picker) return [];
    if (picker.kind === 'acct-existing') {
      const ua = unmatchedAccounts.find((u) => u.csvName === picker.key);
      return (ua?.candidates?.length ? ua.candidates : accounts).map((a: any) => ({ value: a.id, label: accountLabel(a, multiOwnerAccounts) }));
    }
    if (picker.kind === 'acct-type' || picker.kind === 'unrec-type') {
      return Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v as string }));
    }
    if (picker.kind === 'unrec-acct') return accounts.map((a) => ({ value: a.id, label: accountLabel(a, multiOwnerAccounts) }));
    if (picker.kind === 'unrec-cat') {
      const res = unrecRes[Number(picker.key)];
      const items = res?.type ? dictItems.filter((d) => d.group === IMPORT_TYPE_TO_GROUP[res.type]) : dictItems;
      return items.map((d) => ({ value: d.code, label: d.label }));
    }
    return [];
  })();
  const pickerValue = (() => {
    if (!picker) return undefined;
    if (picker.kind === 'acct-existing') return (accountRes[picker.key] as any)?.accountId;
    if (picker.kind === 'acct-type') return (accountRes[picker.key] as any)?.type;
    if (picker.kind === 'unrec-type') return unrecRes[Number(picker.key)]?.type;
    if (picker.kind === 'unrec-acct') return unrecRes[Number(picker.key)]?.accountId;
    if (picker.kind === 'unrec-cat') return unrecRes[Number(picker.key)]?.categoryCode;
    return undefined;
  })();
  const onPickerSelect = (v: string) => {
    if (!picker) return;
    if (picker.kind === 'acct-existing') setAccountRes((p) => ({ ...p, [picker.key]: { action: 'existing', accountId: v } }));
    else if (picker.kind === 'acct-type') setAccountRes((p) => ({ ...p, [picker.key]: { ...(p[picker.key] as any), action: 'create', type: v } }));
    else if (picker.kind === 'unrec-type') setUnrecRes((p) => ({ ...p, [Number(picker.key)]: { ...p[Number(picker.key)], type: v, categoryCode: '' } }));
    else if (picker.kind === 'unrec-acct') setUnrecRes((p) => ({ ...p, [Number(picker.key)]: { ...p[Number(picker.key)], accountId: v } }));
    else if (picker.kind === 'unrec-cat') setUnrecRes((p) => ({ ...p, [Number(picker.key)]: { ...p[Number(picker.key)], categoryCode: v } }));
    setPicker(null);
  };

  // ── 确认导入(构建 overrides 发起 confirm_import) ──
  const handleConfirm = () => {
    if (submitted) return;
    setSubmitted(true);
    setConfirmError('');
    const overrides: Record<string, unknown> = {};
    if (aiArgs.fileId) overrides.fileId = aiArgs.fileId;
    const userAccounts = Object.entries(accountRes).map(([csvName, res]) =>
      res.action === 'existing'
        ? { sourceAccountName: csvName, action: 'existing', targetAccountId: res.accountId }
        : { sourceAccountName: csvName, action: 'create', targetAccountName: res.name, accountType: res.type },
    ).filter((r) => (r as any).targetAccountId || (r as any).targetAccountName);
    if (userAccounts.length > 0) overrides.accountResolutions = userAccounts;
    const userCats = categoryRes.filter((cr) => cr.targetCode && cr.save).map((cr) => ({
      sourceCategory: cr.sourceCategory,
      targetCategoryCode: cr.targetCode,
      recordType: cr.type,
      payerContains: cr.payerContains || undefined,
      descriptionContains: cr.descriptionContains || undefined,
    }));
    if (userCats.length > 0) overrides.categoryResolutions = userCats;
    const userUnrec = unrec.filter((r) => {
      const res = unrecRes[r.rowIndex];
      return res?.type && res?.accountId;
    }).map((r) => ({ rowIndex: r.rowIndex, type: unrecRes[r.rowIndex].type, accountId: unrecRes[r.rowIndex].accountId, categoryCode: unrecRes[r.rowIndex].categoryCode || '' }));
    if (userUnrec.length > 0) overrides.unrecognizedResolutions = userUnrec;

    try {
      confirmAndContinue(accountBookId, toolCall.toolCallId, true, Object.keys(overrides).length > 0 ? overrides : undefined);
    } catch (e: any) {
      setConfirmError(e?.message || '确认请求失败');
      setSubmitted(false);
    }
  };

  const inputStyle = { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, color: colors.foreground } as const;
  const selectBtnStyle = { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.card };

  return (
    <View style={{ marginTop: 4, gap: 8 }}>
      {/* 统计摘要 */}
      {stats && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[['总行数', String(stats.totalLines ?? '-')], ['已解析', String(stats.parsedRows ?? '-')], ['跳过', String(stats.skippedRows ?? '-')], ['待处理', String(unresolvedAcctCount + unresolvedCatCount + unresolvedUnrecCount)]].map(([label, val], i) => (
            <View key={label} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 3, alignItems: 'center' }}>
              <Text style={{ fontSize: 9.5, color: colors.mutedForeground }}>{label}</Text>
              <Text style={{ fontSize: 11, fontWeight: '600', color: i === 1 ? '#22c55e' : i === 2 ? '#f59e0b' : i === 3 ? '#ef4444' : colors.foreground }}>{val}</Text>
            </View>
          ))}
        </View>
      )}
      {/* 跳过/错误详情 */}
      {!!stats?.errors?.length && (
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>跳过/错误 {stats.errors.length} 条{stats.errors[0] ? `：${stats.errors[0]}` : ''}</Text>
      )}

      {/* Tab 切换 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: active ? colors.primary : colors.hairline, backgroundColor: active ? alpha(colors.primary, 0.12) : 'transparent' }}>
              <Text style={{ fontSize: 10.5, fontWeight: active ? '600' : '400', color: active ? colors.primary : colors.mutedForeground }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 记录列表 */}
      {tab === 'records' && (
        <MiniTable
          columns={['#', '日期', '类型', '金额', '账户', '分类', '映射分类', '交易方', '说明']}
          aligns={['left', 'left', 'left', 'right']}
          rows={allRecords.map((r) => {
            let displayDate = r.date;
            try {
              const d = new Date(r.date);
              if (!isNaN(d.getTime())) displayDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            } catch { /* 原样展示 */ }
            return [String(r.rowIndex), displayDate, IMPORT_TYPE_LABELS[r.type] || r.type, (r.amount ?? 0).toFixed(2), r.accountName ?? '-', r.categoryLabel || r.categoryCode || '-', r.mappedCategoryLabel || r.mappedCategoryCode || '-', r.payer || '-', r.remark || '-'];
          })}
          maxHeight={220}
        />
      )}

      {/* 未匹配账户 */}
      {tab === 'accounts' && (
        <View style={{ gap: 8 }}>
          {unmatchedAccounts.length === 0 ? (
            <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>全部账户已匹配</Text>
          ) : (
            <>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>同一银行账户可能有多个名称变体，设为相同名称即可合并</Text>
              {unmatchedAccounts.map((ua) => {
                const res = accountRes[ua.csvName];
                return (
                  <View key={ua.csvName} style={{ backgroundColor: colors.muted, borderRadius: 10, padding: 8, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ flex: 1, fontSize: 11.5, fontWeight: '600' }} numberOfLines={1}>{ua.csvName}</Text>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.card }}>
                        <Text style={{ fontSize: 9.5, color: colors.mutedForeground }}>{res?.action === 'create' ? '新建' : '已有'}</Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          if (res?.action === 'create') setAccountRes((p) => ({ ...p, [ua.csvName]: { action: 'existing', accountId: accounts[0]?.id || '' } }));
                          else setAccountRes((p) => ({ ...p, [ua.csvName]: { action: 'create', name: ua.suggestedName, type: ua.suggestedType } }));
                        }}
                        style={{ paddingHorizontal: 8, paddingVertical: 3 }}
                      >
                        <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>切换</Text>
                      </Pressable>
                    </View>
                    {res?.action === 'create' ? (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TextInput value={res.name} onChangeText={(t) => setAccountRes((p) => ({ ...p, [ua.csvName]: { ...res, name: t } }))} style={{ ...inputStyle, flex: 1 }} />
                        <Pressable onPress={() => setPicker({ kind: 'acct-type', key: ua.csvName })} style={{ ...selectBtnStyle, minWidth: 84 }}>
                          <Text style={{ fontSize: 11 }} numberOfLines={1}>{ACCOUNT_TYPE_LABELS[res.type as keyof typeof ACCOUNT_TYPE_LABELS] ?? res.type ?? '类型'}</Text>
                          <ChevronDown size={11} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => setPicker({ kind: 'acct-existing', key: ua.csvName })} style={selectBtnStyle}>
                        <Text style={{ fontSize: 11, color: (res as any)?.accountId ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
                          {(() => {
                            const a = accounts.find((x) => x.id === (res as any)?.accountId);
                            return a ? accountLabel(a, multiOwnerAccounts) : ((res as any)?.accountId || '选择已有账户...');
                          })()}
                        </Text>
                        <ChevronDown size={11} color={colors.mutedForeground} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </View>
      )}

      {/* 未匹配分类 */}
      {tab === 'categories' && (
        <View style={{ gap: 10 }}>
          {categoryRes.length === 0 ? (
            <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>全部分类已映射</Text>
          ) : (
            [...new Map(categoryRes.map((cr) => [cr.type, categoryRes.filter((e) => e.type === cr.type)])).entries()].map(([type, items]) => (
              <View key={type} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: alpha(semanticTypeColor(colors, type, colors.primary), 0.12) }}>
                    <Text style={{ fontSize: 10, color: semanticTypeColor(colors, type, colors.primary) }}>{IMPORT_TYPE_LABELS[type] ?? type}</Text>
                  </View>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{items.length} 项</Text>
                </View>
                {items.map((cr) => {
                  const updateCr = (patch: Partial<CategoryResolution>) => setCategoryRes((prev) => prev.map((e) => (e.id === cr.id ? { ...e, ...patch } : e)));
                  return (
                    <View key={cr.id} style={{ backgroundColor: colors.muted, borderRadius: 10, padding: 8, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ flex: 1, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>{cr.sourceCategory}</Text>
                        <Pressable hitSlop={4} onPress={() => setCategoryRes((prev) => [...prev, { ...cr, id: String(prev.length), payerContains: '', descriptionContains: '' }])} style={{ padding: 2 }}>
                          <Copy size={12} color={colors.mutedForeground} />
                        </Pressable>
                        <Pressable hitSlop={4} onPress={() => setCategoryRes((prev) => prev.filter((e) => e.id !== cr.id))} style={{ padding: 2 }}>
                          <Trash2 size={12} color="#ef4444" />
                        </Pressable>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TextInput value={cr.payerContains} onChangeText={(t) => updateCr({ payerContains: t })} placeholder="交易方正则" placeholderTextColor={colors.mutedForeground} style={{ ...inputStyle, flex: 1 }} />
                        <TextInput value={cr.descriptionContains} onChangeText={(t) => updateCr({ descriptionContains: t })} placeholder="说明正则" placeholderTextColor={colors.mutedForeground} style={{ ...inputStyle, flex: 1 }} />
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Pressable onPress={() => { setCatSearch(''); setPicker({ kind: 'cat-target', key: cr.id, type: cr.type }); }} style={{ ...selectBtnStyle, flex: 1 }}>
                          <Text style={{ fontSize: 11, color: cr.targetCode ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
                            {cr.targetCode ? (dictItems.find((d) => d.code === cr.targetCode)?.label || cr.targetCode) : '选择分类...'}
                          </Text>
                          <ChevronDown size={11} color={colors.mutedForeground} />
                        </Pressable>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>保存</Text>
                          <Switch value={cr.save} onValueChange={(v) => updateCr({ save: v })} trackColor={{ true: colors.primary }} style={{ transform: [{ scale: 0.75 }] }} />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </View>
      )}

      {/* 未识别记录 */}
      {tab === 'unrec' && (
        <View style={{ gap: 8 }}>
          {unrec.length === 0 ? (
            <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>无未识别记录</Text>
          ) : (
            unrec.map((r) => {
              const res = unrecRes[r.rowIndex] ?? { type: '', accountId: '', categoryCode: '' };
              const resolved = !!res.type && !!res.accountId;
              return (
                <View key={r.rowIndex} style={{ borderRadius: 10, borderWidth: 1, padding: 8, gap: 6, borderColor: resolved ? alpha('#22c55e', 0.3) : '#fb923c', backgroundColor: resolved ? alpha('#22c55e', 0.05) : alpha('#fb923c', 0.08) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 10.5 }}>{r.date}</Text>
                    <Text style={{ fontSize: 10.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{(r.amount ?? 0).toFixed(2)}</Text>
                    <Text style={{ flex: 1, fontSize: 10.5, color: colors.mutedForeground }} numberOfLines={1}>{r.accountName}{r.remark ? ` · ${r.remark}` : ''}</Text>
                    {resolved ? <CheckCircle2 size={12} color="#22c55e" /> : <Text style={{ fontSize: 9.5, color: '#fb923c' }}>未设置</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable onPress={() => setPicker({ kind: 'unrec-type', key: String(r.rowIndex) })} style={selectBtnStyle}>
                      <Text style={{ fontSize: 10.5, color: res.type ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>{IMPORT_TYPE_LABELS[res.type] ?? '类型'}</Text>
                      <ChevronDown size={10} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable onPress={() => setPicker({ kind: 'unrec-acct', key: String(r.rowIndex) })} style={selectBtnStyle}>
                      <Text style={{ fontSize: 10.5, color: res.accountId ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>{(() => {
                        const a = accounts.find((x) => x.id === res.accountId);
                        return a ? accountLabel(a, multiOwnerAccounts) : '账户';
                      })()}</Text>
                      <ChevronDown size={10} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable onPress={() => setPicker({ kind: 'unrec-cat', key: String(r.rowIndex) })} style={selectBtnStyle}>
                      <Text style={{ fontSize: 10.5, color: res.categoryCode ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>{dictItems.find((d) => d.code === res.categoryCode)?.label ?? '分类'}</Text>
                      <ChevronDown size={10} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* 操作栏 */}
      {confirmError ? (
        <View style={{ borderRadius: 8, borderWidth: 1, borderColor: alpha('#ef4444', 0.4), backgroundColor: alpha('#ef4444', 0.08), padding: 8 }}>
          <Text style={{ fontSize: 11, color: '#ef4444' }}>{confirmError}</Text>
        </View>
      ) : null}
      {!isConfirmed ? (
        <Pressable
          onPress={handleConfirm}
          disabled={submitted}
          style={{ borderRadius: 10, paddingVertical: 9, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, opacity: submitted ? 0.6 : 1 }}
        >
          {submitted && <ActivityIndicator size="small" color={colors.primaryForeground} />}
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.primaryForeground }}>{submitted ? '提交中...' : '确认无误，继续导入'}</Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={14} color="#22c55e" />
          <Text style={{ fontSize: 11.5, color: '#22c55e' }}>已确认，等待导入...</Text>
        </View>
      )}

      {/* 底部选择弹窗 */}
      <FormSheet visible={picker !== null} title={pickerTitle} onClose={() => setPicker(null)}>
        <View style={{ maxHeight: 420 }}>
          {/* 目标分类:带搜索 + 分组 */}
          {picker?.kind === 'cat-target' ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }}>
                <Search size={13} color={colors.mutedForeground} />
                <TextInput value={catSearch} onChangeText={setCatSearch} placeholder="搜索分类..." placeholderTextColor={colors.mutedForeground} style={{ flex: 1, fontSize: 12.5, color: colors.foreground, padding: 0 }} />
              </View>
              <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
                {[...groupedDict(picker.type ?? '').entries()].map(([group, items]) => (
                  <View key={group}>
                    <Text style={{ fontSize: 10, color: colors.mutedForeground, paddingHorizontal: 4, paddingVertical: 4, fontWeight: '600' }}>{IMPORT_GROUP_HEADING[group] ?? group}</Text>
                    {items.map((d) => (
                      <Pressable key={d.code} onPress={() => { const p = picker; setCategoryRes((prev) => prev.map((e) => (e.id === p.key ? { ...e, targetCode: d.code } : e))); setPicker(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 9 }}>
                        <CheckCircle2 size={13} color={categoryRes.find((e) => e.id === picker.key)?.targetCode === d.code ? '#22c55e' : 'transparent'} />
                        <Text style={{ fontSize: 13 }}>{d.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
                {filteredDict(picker.type ?? '').length === 0 && (
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 16 }}>无匹配结果</Text>
                )}
              </ScrollView>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
              {pickerOptions.map((o) => (
                <Pressable key={o.value} onPress={() => onPickerSelect(o.value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 }}>
                  <CheckCircle2 size={13} color={pickerValue === o.value ? '#22c55e' : 'transparent'} />
                  <Text style={{ flex: 1, fontSize: 13 }}>{o.label}</Text>
                </Pressable>
              ))}
              {pickerOptions.length === 0 && (
                <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 16 }}>无可选项</Text>
              )}
            </ScrollView>
          )}
        </View>
      </FormSheet>
    </View>
  );
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
        // 列宽按表头+全部单元格统一计算,保证各行列对齐
        const colWidths = computeColWidths([parsed.columns, ...parsed.rows.map((r) => r.map((cell) => cell.text))], parsed.columns.length);
        return (
          <View style={{ borderRadius: 8, borderWidth: 1, borderColor: c.hairline, overflow: 'hidden', maxHeight: 180 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
              <View>
                <View style={{ flexDirection: 'row', backgroundColor: c.muted }}>
                  {parsed.columns!.map((col, i) => (
                    <View key={`${col}-${i}`} style={{ width: colWidths[i], paddingHorizontal: 6, paddingVertical: 4 }}>
                      <Text numberOfLines={1} style={{ fontSize: 10.5, color: c.mutedForeground, fontWeight: '600' }}>{col}</Text>
                    </View>
                  ))}
                </View>
                {parsed.rows!.map((row, ri) => (
                  <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.hairline }}>
                    {row.map((cell, ci) => (
                      <View key={ci} style={{ width: colWidths[ci], paddingHorizontal: 6, paddingVertical: 4 }}>
                        <Text numberOfLines={1} style={{ fontSize: 10.5, color: cellColor(cell.color), fontWeight: cell.highlight ? '700' : '400' }}>{cell.text}</Text>
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

      {/* preview_import 预览模式:完整交互卡(复刻 web ImportPreviewInteractive) */}
      {isInteractivePreview && showResult && (() => {
        const d = (toolCall.result as any)?.data ?? toolCall.result;
        if (!d?.accountBookId) {
          return (
            <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>
              {typeof d === 'object' ? JSON.stringify(d).slice(0, 200) : String(d ?? '')}
            </Text>
          );
        }
        return <ImportPreviewCard toolCall={toolCall} bookId={bookId} />;
      })()}

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
