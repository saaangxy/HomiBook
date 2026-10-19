import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, SectionList, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Markdown from 'react-native-markdown-display';
import { ArrowDown, Bot, Brain, Camera, ChevronDown, ChevronLeft, ChevronRight, FileText, FileUp, Globe, ImagePlus, List, Pencil, Plus, RefreshCw, Send, Sparkles, StopCircle, Trash2, X } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAppearProgress } from '@/components/ui/useAppearAnimation';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ConfirmSheet } from '@/components/chrome/ConfirmSheet';
import { showToast } from '@/components/chrome/Toast';
import { ImageLightbox, isImageUrl } from '@/components/ui/AttachmentViewer';
import { GREETING_ID, setStreamPaused, useChatStore, useSessionView, type ChatSession } from '@/stores/chat';
import { useUIShell } from '@/components/chrome/chrome';
import { uploadImage, loadToolNames } from '@/services/chat';
import { isBillFile, uploadImportFile } from '@/services/import';
import { DownloadModeSheet } from '@/components/chrome/DownloadModeSheet';
import { downloadAttachment, resolveRemoteUrl, type DownloadMode } from '@/services/http';
import type { Message, MessageBlock, ChatInjection } from '@homibook/core';
import { IMPORT_AI_SOURCES, IMPORT_SOURCE_LABELS, buildImportMessage, parseImportMessage } from '@homibook/core';


// 拆分出的子组件(工具卡/导入预览卡)
import { ToolCard } from './ToolCard';
import { ImportFileCard } from './ImportPreviewCard';

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

/**
 * 消息是否有可渲染内容 —— 空文本块不计入。
 * 与 web `MessageBubble` 的口径一致:那里对每个 block 单独渲染气泡,空 text 块 `return null`;
 * 移动端的气泡是包住所有 block 的外层容器,所以必须在外面判断,否则纯附件消息会留下一个空气泡。
 */
function hasRenderableBlocks(message: Message): boolean {
  return message.blocks.some((b) => (b.type === 'text' ? !!b.content.trim() : true));
}

/** 取消息的全部文本内容(与 web MessageBubble.getMessageText 同口径) */
function getMessageText(message: Message): string {
  return message.blocks
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('\n');
}

// 空状态快捷指令(点击填入输入框,降低上手门槛)
const QUICK_PROMPTS = ['本月花了多少？', '餐饮超预算了吗？', '帮我分析支出趋势'];

// onClose:宿主为独立弹窗时提供关闭按钮(渲染在工具行右侧);嵌入 RecordModal 等容器时不传
// shareIntake:仅全局 AI 弹窗传 true —— 系统分享带入的草稿只由该实例消费
// (记一笔的 AI 实例可能同时处于挂载状态,不参与消费以免把待发图片截走)
export function AIAssistant({ onClose, shareIntake }: { onClose?: () => void; shareIntake?: boolean }) {
  const { colors } = useTheme();
  const { currentLedger, pendingShare, consumePendingShare } = useUIShell();
  const bookId = currentLedger.id;

  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(true);
  /** 编辑态:非 null 表示正在编辑这条用户消息(复用下方输入框,提交走与 web 一致的「同父分支」逻辑) */
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [pendingImages, setPendingImages] = useState<{ id: string; uri: string; fullUrl: string; originalFilename: string }[]>([]);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  /** 待确认删除的会话:抽屉里的删除是危险操作,先弹确认再执行 */
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null);
  // 会话列表抽屉入场(共享值驱动,替代 entering —— 见 useAppearAnimation.ts 顶部说明)
  const drawerAppear = useAppearProgress({ active: sessionListOpen });
  const drawerAnim = useAnimatedStyle(() => ({
    opacity: drawerAppear.value,
    transform: [{ translateX: -(1 - drawerAppear.value) * 48 }],
  }));
  const insets = useSafeAreaInsets();
  // 导入弹窗(自定义来源选择,对齐 web DropdownMenu 的支付宝/微信/京东三选项)
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  // 全屏图片预览(待发缩略图 / 消息附件图共用)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const listRef = useRef<FlatList>(null);
  // 列表是否接近底部:仅接近底部时自动跟随滚动,用户上翻(查看历史/批量确认工具卡)时内容变化不再强制滚到底
  const isAtBottomRef = useRef(true);
  // 是否贴底(state 版,用于控制「回到底部」按钮显隐)
  const [atBottom, setAtBottom] = useState(true);
  // 刚打开/切换会话:后续几批消息到达都要重新贴底,直到用户自己上翻
  const forceBottomRef = useRef(true);
  /** 切会话时内容区的滑入/淡入(初始 1 = 正常显示,切会话时从 0.3/12px 动画到 1/0) */
  const enterOpacity = useSharedValue(1);
  const enterY = useSharedValue(0);
  const sessionEnterStyle = useAnimatedStyle(() => ({
    opacity: enterOpacity.value,
    transform: [{ translateY: enterY.value }],
  }));
  // 手指是否按在列表上:按住期间绝不程序化滚动 —— Android 原生 ScrollView 在滚动时会抢走触摸响应,
  // 使按下的卡片/按钮收不到 onPress。文本增量已由 setStreamPaused 冻结,但工具卡等结构性事件
  // 仍会即时改变布局,故保留这层保护。
  const userTouchingRef = useRef(false);

  const {
    sessions, sessionsLoading, currentSessionId,
    loadSessions, openSession, newSession, deleteSession,
    sendMessage, retryMessage, stopStreaming, selectBranch,
  } = useChatStore();
  // 当前会话消息视图(活跃路径按分支选择派生,单一数据源在 sessionCache)
  const { messages, allMessages, loading: messagesLoading } = useSessionView();

  // 当前会话(标题栏展示)
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  /** 「今天」的日期键:在打开抽屉的事件里取一次(渲染期间读时钟会触发 react-hooks/purity) */
  const [todayKey, setTodayKey] = useState('');
  /** 会话按「今天/昨天/日期」分组(与 web 端会话列表口径一致,长列表更好扫读) */
  const sessionGroups = useMemo(() => {
    const groups: { title: string; data: ChatSession[] }[] = [];
    const yesterdayKey = todayKey ? new Date(new Date(todayKey).getTime() - 86400000).toDateString() : '';
    for (const s of sessions) {
      const d = new Date(s.updatedAt).toDateString();
      const title = d === todayKey ? '今天' : d === yesterdayKey ? '昨天' : new Date(s.updatedAt).toLocaleDateString('zh-CN');
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(s);
      else groups.push({ title, data: [s] });
    }
    return groups;
  }, [sessions, todayKey]);
  // 服务端返回的附件/图片 url 多为相对路径,统一转完整地址(含 host 校准,见 http.resolveRemoteUrl)
  const isStreaming = useChatStore((s) => s.sessionCache[s.currentSessionId ?? '']?.isStreaming ?? false);

  /** 用户发送的消息(按列表顺序):右侧导航条据此渲染缩略标记,拖动时用 text 做气泡预览 */
  const navItems = useMemo(() => {
    const items: { id: string; index: number; text: string }[] = [];
    messages.forEach((m, index) => {
      if (m.role !== 'user') return;
      items.push({
        id: m.id,
        index,
        text: getMessageText(m).trim() || (m.attachments?.length ? '（图片/附件）' : '（空消息）'),
      });
    });
    return items;
  }, [messages]);

  useEffect(() => {
    loadSessions();
    // 工具显示名称缓存(对齐 web loadToolNames)
    loadToolNames();
  }, [loadSessions]);

  // Android 返回键:会话抽屉打开时先关抽屉,而不是直接把整个 AI 弹窗关掉
  useEffect(() => {
    if (!sessionListOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSessionListOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [sessionListOpen]);

  // 系统分享带入的聊天草稿:并入待发附件/输入框后清空(含登录后补传的暂存图片)
  useEffect(() => {
    if (!shareIntake || !pendingShare) return;
    if (pendingShare.attachments.length > 0) {
      setPendingImages((p) => [...p, ...pendingShare.attachments]);
    }
    const shareText = pendingShare.text;
    if (shareText) setInput((prev) => (prev ? `${prev} ${shareText}` : shareText));
    consumePendingShare();
  }, [shareIntake, pendingShare, consumePendingShare]);

  // 切换会话:恢复自动跟随,并在新会话内容加载后落到底部(打开会话应看到最新消息,而不是顶部)
  useEffect(() => {
    isAtBottomRef.current = true;
    forceBottomRef.current = true;
    // 放到下一帧,避免在 effect 体内同步 setState(react-hooks/set-state-in-effect)
    const raf = requestAnimationFrame(() => setAtBottom(true));
    return () => cancelAnimationFrame(raf);
  }, [currentSessionId]);

  // 切换会话 / 历史加载完成:内容区滑入 + 淡入。
  // 用 0.3 而不是 0 起步 —— 切会话的数据替换在同一帧完成,完全透明会闪一下白
  useEffect(() => {
    if (messagesLoading) return;
    enterOpacity.set(0.3);
    enterY.set(12);
    enterOpacity.set(withTiming(1, { duration: 220 }));
    enterY.set(withTiming(0, { duration: 220 }));
  }, [currentSessionId, messagesLoading, enterOpacity, enterY]);

  // 消息到达(首屏 / 切会话分批加载):贴底。用延时而非立即 scrollToEnd —— 首次渲染时内容高度还没测量完
  useEffect(() => {
    if (messagesLoading || !forceBottomRef.current) return;
    const timer = setTimeout(() => {
      if (!forceBottomRef.current) return;
      listRef.current?.scrollToEnd({ animated: false });
    }, 60);
    return () => clearTimeout(timer);
  }, [messagesLoading, messages.length, currentSessionId]);

  // 滚动位置跟踪:判断用户是否处于底部附近(留 80px 容差)
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
    isAtBottomRef.current = near;
    // 用户主动上翻后不再强行贴底
    if (!near) forceBottomRef.current = false;
    setAtBottom(near);
  };

  // ── 右侧消息导航:按用户发送的消息快速跳转 ──
  /** 拖动中选中的用户消息序号(对应 navItems);null = 未拖动 */
  const [navActive, setNavActive] = useState<number | null>(null);
  /** 导航条实测高度(用于把手指 y 换算成消息序号) */
  const [navBarH, setNavBarH] = useState(0);
  /** 消息区高度(气泡跟随时的边界限制) */
  const [listH, setListH] = useState(0);
  const navActiveRef = useRef<number | null>(null);
  /** 拖动位置的 shared value:气泡用动画驱动跟随,不触发 React 重渲染 */
  const navY = useSharedValue(0);
  const navBubbleStyle = useAnimatedStyle(() => {
    // navY 是「内层标记区」内的坐标,而内层在列表里垂直居中 —— 必须补上这段偏移,
    // 否则气泡会整体高出半个列表(手指在中部、气泡跑到顶部)
    const barTop = Math.max(0, (listH - navBarH) / 2);
    return { top: Math.max(8, Math.min(barTop + navY.value - 24, Math.max(8, listH - 80))) };
  });

  /**
   * 导航条上下内边距:标记视觉上紧凑居中,但触摸区要留够 ——
   * 纯标记高度只有几条横线,手指很难点中,所以用内边距把响应区撑大
   */
  const NAV_PAD_Y = 22;
  /**
   * 标记间距:消息少时放宽(每条更好停准),消息多时收紧(整条轨道不超出可视区)。
   * 每条消息的可选高度 ≈ 标记高 + 间距,取值 12 时约 15px,手指够用。
   */
  const navGap = navItems.length <= 10 ? 12 : navItems.length <= 18 ? 9 : 6;

  /** 手指 y → 最近的用户消息序号 */
  const navIndexAt = (y: number) => {
    if (navItems.length === 0 || navBarH <= 0) return 0;
    const usable = Math.max(1, navBarH - NAV_PAD_Y * 2);
    const ratio = Math.min(1, Math.max(0, (y - NAV_PAD_Y) / usable));
    return Math.round(ratio * (navItems.length - 1));
  };

  const handleNavTouch = (y: number) => {
    // 气泡位置每帧都要跟手:走 shared value(UI 线程),不做 setState
    navY.set(y);
    const k = navIndexAt(y);
    // 只有跨到另一条消息才 setState:拖动过程中每帧重渲染整个消息列表会明显掉帧
    if (navActiveRef.current === k) return;
    navActiveRef.current = k;
    setNavActive(k);
  };

  /** 松手才真正跳转(拖动过程中只预览内容,避免列表来回抖) */
  const handleNavRelease = () => {
    const k = navActiveRef.current;
    navActiveRef.current = null;
    setNavActive(null);
    if (k === null) return;
    const item = navItems[k];
    if (!item) return;
    // 跳过去后不要让「贴底」逻辑把人拉回底部
    forceBottomRef.current = false;
    isAtBottomRef.current = false;
    setAtBottom(false);
    // 平滑滑动到目标消息(原先瞬时跳转,看不出「切换」的过程)
    listRef.current?.scrollToIndex({ index: item.index, animated: true, viewPosition: 0 });
  };

  // 内容尺寸变化(含流式增量)时跟随到底部;用户已上翻、或手指正按在列表上时不打扰
  const handleContentSizeChange = () => {
    if (userTouchingRef.current || !isAtBottomRef.current) return;
    // 流式增量用瞬时滚动:持续运行的滚动动画会反复抢占手势,吞掉下游点击
    listRef.current?.scrollToEnd({ animated: !isStreaming });
  };

  // 手指按住消息列表:暂停流式增量刷新(布局彻底停止变化 → 按压不会被 ACTION_CANCEL 吞掉),
  // 同时禁止程序化滚动;松手恢复并补刷一次。见 stores/chat.ts「流式增量刷新调度」
  const handleListTouchStart = () => {
    userTouchingRef.current = true;
    setStreamPaused(true);
  };
  const handleListTouchEnd = () => {
    userTouchingRef.current = false;
    setStreamPaused(false);
  };
  // 输入区工具行同理会吞按压:按住期间暂停刷新,否则「停止/联网/图片/附件」点了没反应
  const handleComposerTouchStart = () => setStreamPaused(true);
  const handleComposerTouchEnd = () => setStreamPaused(false);

  // 发送指定文本(输入框发送与快捷指令直发共用)。
  // preset 是在别处上传好的附件(账单导入入口:文件先落成一个附件,再把 attachmentId 交给 AI)
  const sendText = (msg: string, preset?: { id: string; url: string; originalFilename: string }[]) => {
    const hasPendingImages = pendingImages.length > 0;
    const hasPreset = !!preset?.length;
    if ((!msg && !hasPendingImages && !hasPreset) || isStreaming || !bookId) return;
    haptics.tap();
    // 待发附件快照:ids 给后端,完整信息给本地回显
    const pending = [...pendingImages];
    setPendingImages([]);
    const attachmentIds = [...pending.map((p) => p.id), ...(preset ?? []).map((p) => p.id)];
    const localAttachments = hasPendingImages || hasPreset
      ? [...pending.map((p) => ({ id: p.id, url: p.fullUrl, originalFilename: p.originalFilename })), ...(preset ?? [])]
      : undefined;
    if (!currentSessionId) {
      newSession(bookId).then((s) => {
        if (s) sendMessage(bookId, msg, undefined, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch, localAttachments);
      });
      return;
    }
    // 父 = 对话末端**有实体**的消息:从末尾往前找第一条有 dbId 的(本地锚点 greeting 也算),
    // 临时 msg-* 跳过(不能落库,会写悬空外键)。
    //
    // 不能只认最后一条:上游报错时错误以**流内 error part** 到达,后端只推 error 事件不落库,
    // 末条 assistant 永远没有 dbId → parentId 丢空 → 落库成 null → 刷新后与首条用户消息
    // 成了同一父下的多版本分支(消息"跑"到会话开头)。
    let parentId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.dbId) { parentId = m.dbId; break; }
      if (m.id === GREETING_ID) { parentId = GREETING_ID; break; }
    }
    sendMessage(bookId, msg, parentId, undefined, attachmentIds.length ? attachmentIds : undefined, webSearch, localAttachments);
  };

  /**
   * 点击自己的文本消息 ⇒ 用**下方已有输入框**进入编辑态。
   * 与 web 一致:只对「含文本的用户消息」开放;流式中不可编辑(内容还在变)。
   */
  const beginEdit = (item: Message) => {
    if (isStreaming) return;
    const text = getMessageText(item);
    if (!text.trim()) return;
    setPendingImages([]); // 编辑的是既有消息,待发附件先清掉,避免混入
    setEditingMsg(item);
    setInput(text);
    haptics.tap();
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setInput('');
  };

  /**
   * 编辑重发:与 web ChatWindow.handleEditSubmit 同一套逻辑 ——
   * 新消息挂在「被编辑消息的 parentMessageId」下,于是它与被编辑的那条成为**兄弟**,
   * 形成可切换的版本分支(而不是在末尾新发一条);附件沿用原消息(改完文字不该丢图/文件)。
   * 注:本端 sendMessage 第 6 参是 enableWebSearch、第 7 参才是 localAttachments。
   */
  const submitEdit = () => {
    const target = editingMsg;
    const newText = input.trim();
    if (!target || !newText || !bookId) return;
    const idx = messages.findIndex((m) => m.id === target.id);
    if (idx < 0) return;
    const attachments = messages[idx].attachments;
    setEditingMsg(null);
    setInput('');
    haptics.tap();
    sendMessage(bookId, newText, messages[idx].parentMessageId, undefined, attachments?.map((a) => a.id), undefined, attachments);
  };

  const handleSend = () => {
    // 编辑态下发送 = 提交编辑(生成新版本),不再新发一条消息
    if (editingMsg) { submitEdit(); return; }
    const msg = input.trim();
    if (!msg && pendingImages.length === 0) return;
    setInput('');
    sendText(msg);
  };

  /** 选择并上传附件:不限类型(与 web 端回形针一致);图片按缩略图渲染,其余显示为文件条。
   *  csv/excel 在这里只作普通附件 —— 要导入账单走「导入账单」入口,不在这里识别来源。 */
  const handlePickFile = async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;
      // 可选多个(与 web input multiple 一致),逐个上传后一起进入待发送列表
      for (const asset of result.assets) {
        const fileName = asset.name || 'attachment';
        // 直接上传选择器返回的文件(File.upload 原生 IO 可读;复制到原名文件会触发权限限制)
        // 注:后端 originalFilename 取 multipart filename(cache 随机 id + 原扩展名),本地回显用选择器原名
        const up = await uploadImage(asset.uri, fileName, asset.mimeType || 'application/octet-stream');
        setPendingImages((p) => [...p, { id: up.id, uri: resolveRemoteUrl(up.fullUrl || up.url), fullUrl: up.fullUrl || up.url, originalFilename: fileName }]);
      }
    } catch (e: any) {
      showToast(`上传失败: ${e?.message || '未知错误'}`);
    }
  };

  /** 拍照上传:与 handlePickFile 同链路,来源为相机(图片记账/小票识别场景) */
  const handleCamera = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { showToast('需要相机权限'); return; }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = asset.fileName || `camera-${Date.now()}.jpg`;
      const up = await uploadImage(asset.uri, fileName, asset.mimeType || 'image/jpeg');
      setPendingImages((p) => [...p, { id: up.id, uri: resolveRemoteUrl(up.fullUrl || up.url), fullUrl: up.fullUrl || up.url, originalFilename: fileName }]);
    } catch (e: any) {
      showToast(`上传失败: ${e?.message || '未知错误'}`);
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
      showToast(`下载失败: ${e?.message || '未知错误'}`);
    }
  };

  // 账单导入(csv/excel):选来源 → 上传成附件 → 发送「请导入XX账单文件」+ 该附件(与 web 端一致)。
  // 消息里不带任何 id:模型从附件清单(attachmentId + 文件名)取 id 调 preview_import 引导预览/确认。
  // 来源标签统一来自 core IMPORT_SOURCE_LABELS

  const handleImport = async (source: string) => {
    setImportSheetOpen(false);
    try {
      const DocumentPicker = await import('expo-document-picker');
      // 不按 MIME 过滤(说明见 services/import.ts:isBillFile):Android SAF 对 CSV 报的 MIME
      // 不统一,只声明 'text/csv' 会让 CSV 在系统选择器里不可见。放开后按扩展名校验。
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*',
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = asset.name || '账单.csv';
      if (!isBillFile(fileName)) {
        showToast('请选择 CSV / XLS / XLSX 格式的账单文件');
        return;
      }
      const up = await uploadImportFile(asset.uri, fileName);
      if (!up?.attachmentId) throw new Error('服务端未返回附件标识');
      // 账单文件就是一个附件:连同 attachmentId 一起发出,AI 从附件清单取 id 调 preview_import
      sendText(buildImportMessage({ source }), [{ id: up.attachmentId, url: up.url, originalFilename: up.filename }]);
    } catch (e: any) {
      showToast(`导入失败: ${e?.message || '未知错误'}`);
    }
  };

  const handleRetry = (assistantMsgId: string) => {
    if (!bookId) return;
    const idx = messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const prev = messages[idx - 1];
    if (prev.role !== 'user') return;
    const text = prev.blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n');
    // 附件随原消息一起重发:否则新插入的用户消息没有附件 —— 模型既看不到图,也收不到
    // 附件清单(表现为「重试后 AI 忘了刚才那张图/那个账单文件」)。纯图片消息(无文本)
    // 同样允许重试(后端 schema 要求「文本或附件至少一个」)。
    const attachments = prev.attachments;
    if (!text && !attachments?.length) return;
    const assistantDbId = messages[idx].dbId || messages[idx].id;
    // 重试要顶替被重试的那一轮：新消息与被重试的前一条用户消息同父，
    // 否则会被插到别处、旧回复也不被替换（原「往前找 dbId」会跳过本地父而错位）
    const parentId = prev.parentMessageId;
    retryMessage(assistantMsgId);
    // replaceAssistantDbId 告知后端删除旧回复并重新生成
    // 注:本端 sendMessage 第 6 参是 enableWebSearch、第 7 参才是 localAttachments
    sendMessage(bookId, text, parentId, assistantDbId, attachments?.map((a) => a.id), undefined, attachments);
  };

  /** 打开会话抽屉:顺手记下「今天」用于分组标题(见 todayKey 注释) */
  const openSessionList = () => {
    setTodayKey(new Date().toDateString());
    setSessionListOpen(true);
  };

  // 会话抽屉操作(左侧抽屉:AI 弹窗与记一笔 AI tab 共用同一份实现)
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
  /**
   * 确认后删除。不加乐观 toast:store 的 deleteSession 失败时是静默忽略的,
   * 一句「已删除」会和「行还在列表里」自相矛盾;行消失 / 当前会话回到空态本身就是反馈。
   */
  const confirmDeleteSession = () => {
    const target = sessionToDelete;
    setSessionToDelete(null);
    if (!target) return;
    deleteSession(target.id);
    haptics.warn();
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
    // 分支版本:同一父消息下的兄弟消息(编辑/重试产生)。与 web MessageBubble 同口径 ——
    // 切换器显示在「分支消息自身」上(以前是在父消息下列「版本 N」按钮,位置与双端不一致)。
    const versions = item.parentMessageId
      ? allMessages.filter((m) => m.parentMessageId === item.parentMessageId)
      : [];
    const versionIndex = versions.findIndex((v) => (v.dbId || v.id) === (item.dbId || item.id));

    if (isUser) {
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
          {/* 列:气泡在上、附件在气泡**下方**(与 web MessageBubble 一致,不再塞进气泡内) */}
          <View style={{ maxWidth: '82%', alignItems: 'flex-end', gap: 6 }}>
            {/* 版本切换(对齐 web MessageBubble):同一父下的兄弟消息之间切换 */}
            {versions.length > 1 && versionIndex >= 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Pressable
                  hitSlop={8}
                  disabled={versionIndex <= 0}
                  onPress={() => {
                    const prev = versions[versionIndex - 1];
                    if (item.parentMessageId && prev) selectBranch(item.parentMessageId, prev.dbId || prev.id);
                  }}
                  style={{ padding: 2, opacity: versionIndex <= 0 ? 0.3 : 1 }}
                >
                  <ChevronLeft size={14} color={colors.mutedForeground} />
                </Pressable>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontWeight: '500', minWidth: 36, textAlign: 'center' }}>
                  {versionIndex + 1}/{versions.length}
                </Text>
                <Pressable
                  hitSlop={8}
                  disabled={versionIndex >= versions.length - 1}
                  onPress={() => {
                    const next = versions[versionIndex + 1];
                    if (item.parentMessageId && next) selectBranch(item.parentMessageId, next.dbId || next.id);
                  }}
                  style={{ padding: 2, opacity: versionIndex >= versions.length - 1 ? 0.3 : 1 }}
                >
                  <ChevronRight size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>
            )}
            {/* 用户气泡:主色,右上角收窄(web: rounded-2xl rounded-tr-md)。
                点击气泡本体 ⇒ 用下方输入框进入编辑态;附件区留在可点区域之外,不受影响。
                纯附件消息(无文本)不渲染气泡本体 —— 与 web MessageBubble 跳过空文本块同口径 */}
            {hasRenderableBlocks(item) && (
              <Pressable
                onPress={() => beginEdit(item)}
                disabled={isStreaming}
                style={[bubbleBase, { backgroundColor: colors.primary, borderTopRightRadius: 5 }]}
              >
                <View style={{ gap: 6 }}>
                  {item.blocks.map((b) => renderBlock(b, true))}
                </View>
              </Pressable>
            )}
            {item.attachments && item.attachments.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                {(() => {
                  const atts = item.attachments!;
                  const imgAtts = atts.filter((x) => isImageUrl(x.url));
                  const imgUrls = imgAtts.map((x) => resolveRemoteUrl(x.url));
                  return atts.map((a) => {
                    // 非图片附件:文件条(对齐 web:边框 + 卡片底 + 图标方块 + 文件名 + 「附件」),点击下载
                    if (!isImageUrl(a.url)) {
                      return (
                        <Pressable
                          key={a.id}
                          onPress={() => handleDownloadAttachment(a.url, a.originalFilename)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 220, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 8 }}
                        >
                          <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}>
                            <FileText size={15} color={colors.mutedForeground} />
                          </View>
                          <View style={{ flexShrink: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.foreground }}>{a.originalFilename}</Text>
                            <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 1 }}>附件</Text>
                          </View>
                        </Pressable>
                      );
                    }
                    // 图片附件:缩略图(web w-20),点击进全屏预览(仅在图片集合内翻页)
                    const idx = imgAtts.findIndex((x) => x.id === a.id);
                    return (
                      <Pressable key={a.id} onPress={() => setLightbox({ images: imgUrls, index: idx })}>
                        <Image source={{ uri: resolveRemoteUrl(a.url) }} style={{ width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: colors.border }} />
                      </Pressable>
                    );
                  });
                })()}
              </View>
            )}
            {/* 本轮注入的上下文(日期/记忆/技能/附件清单):折叠展示,不属于对话正文 */}
            {item.injections?.map((injection) => (
              <InjectChip key={injection.id} injection={injection} />
            ))}
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
          {/* 无可渲染内容时整个气泡不出现(与 web 相同);纯空消息只保留头像,不留空灰块 */}
          {(isEmptyStreaming || hasRenderableBlocks(item)) && (
            <View style={[bubbleBase, { backgroundColor: alpha(colors.foreground, 0.05), borderTopLeftRadius: 5, alignSelf: isEmptyStreaming ? 'flex-start' : 'stretch' }]}>
              {isEmptyStreaming ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                  <Text style={{ fontSize: 13, color: colors.mutedForeground }}>思考中...</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>{item.blocks.map((b) => renderBlock(b))}</View>
              )}
            </View>
          )}
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
        <Pressable onPress={openSessionList} style={iconBtn}>
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
      <Animated.View style={[{ flex: 1 }, sessionEnterStyle]} onLayout={(e) => setListH(e.nativeEvent.layout.height)}>
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 14 }}
        onContentSizeChange={handleContentSizeChange}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        // 按压期间暂停自动滚动与流式刷新(见 handleListTouchStart 注释),否则工具卡/思考卡展开会被滚动手势吞掉。
        // 拖拽/惯性滚动结束时兜底复位,避免手指移出列表导致标记卡住、后续不再自动跟随
        onTouchStart={handleListTouchStart}
        onTouchEnd={handleListTouchEnd}
        onTouchCancel={handleListTouchEnd}
        onScrollEndDrag={handleListTouchEnd}
        onMomentumScrollEnd={handleListTouchEnd}
        // scrollToIndex 只能定位已渲染的行:先按平均高度估算偏移,下一帧再精确定位
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0 });
          }, 180);
        }}
        ListEmptyComponent={
          messagesLoading ? (
            <LoadingState paddingVertical={80} text="正在加载聊天记录..." />
          ) : (
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
          )
        }
      />
      {/* 右侧消息导航:每条「用户发送」的消息一个缩略标记(紧凑居中,不再按整条轨道均分),按住上下滑动定位 */}
      {navItems.length >= 2 && (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, justifyContent: 'center', alignItems: 'flex-end', zIndex: 20 }}
        >
          <View
            onLayout={(e) => setNavBarH(e.nativeEvent.layout.height)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(e) => handleNavTouch(e.nativeEvent.locationY)}
            onResponderMove={(e) => handleNavTouch(e.nativeEvent.locationY)}
            onResponderRelease={handleNavRelease}
            onResponderTerminate={handleNavRelease}
            // 同向再放宽一圈,避免贴着边缘按不准
            hitSlop={{ top: 16, bottom: 16, left: 12, right: 4 }}
            style={{ paddingVertical: NAV_PAD_Y, paddingLeft: 26, paddingRight: 6, gap: navGap, alignItems: 'flex-end' }}
          >
            {navItems.map((it, k) => (
              <View
                key={it.id}
                style={{
                  width: navActive === k ? 14 : 8,
                  height: navActive === k ? 4 : 3,
                  borderRadius: 2,
                  backgroundColor: navActive === k ? colors.primary : alpha(colors.foreground, 0.28),
                }}
              />
            ))}
          </View>
        </View>
      )}
      {/* 拖动中的内容气泡:跟随手指位置(shared value 驱动,不触发列表重渲染),展示该条发送的消息内容 */}
      {navActive !== null && navItems[navActive] && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute', right: 32, zIndex: 21,
              maxWidth: '72%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
              backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
              shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
            },
            navBubbleStyle,
          ]}
        >
          <Text style={{ fontSize: 12, lineHeight: 18, color: colors.foreground }} numberOfLines={3}>
            {navItems[navActive].text}
          </Text>
        </Animated.View>
      )}
      {/* 上翻阅读历史时出现:一键回到最新消息 */}
      {!atBottom && (
        <Pressable
          onPress={() => {
            isAtBottomRef.current = true;
            forceBottomRef.current = true;
            setAtBottom(true);
            listRef.current?.scrollToEnd({ animated: true });
          }}
          hitSlop={6}
          style={{
            position: 'absolute', right: 16, bottom: 14, zIndex: 30,
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
            borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
          }}
        >
          <ArrowDown size={13} color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>回到底部</Text>
        </Pressable>
      )}
      </Animated.View>

      {/* 输入区(仿网页组合式输入框:文本框在上,工具行在下,发送靠右) */}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.hairline }}>
        {/* 编辑态提示:点明「发送 = 生成新版本」,并提供取消 */}
        {editingMsg && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
            <Pencil size={12} color={colors.primary} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: colors.primary }}>正在编辑消息 · 发送后生成新版本</Text>
            <Pressable hitSlop={8} onPress={cancelEdit} style={composerBtn}>
              <X size={14} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}
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
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder={editingMsg ? '修改后发送(生成新版本)…' : '输入消息…'}
            placeholderTextColor={colors.mutedForeground}
            style={{ minHeight: 34, maxHeight: 108, color: colors.foreground, fontSize: 14, lineHeight: 19, paddingHorizontal: 2, paddingVertical: 4 }}
            multiline
          />
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}
            onTouchStart={handleComposerTouchStart}
            onTouchEnd={handleComposerTouchEnd}
            onTouchCancel={handleComposerTouchEnd}
          >
            <Pressable hitSlop={8} onPress={handlePickFile} style={composerBtn}>
              <ImagePlus size={17} color={colors.mutedForeground} />
            </Pressable>
            <Pressable hitSlop={8} onPress={handleCamera} style={composerBtn}>
              <Camera size={17} color={colors.mutedForeground} />
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

      {/* 会话列表:占满整个 AI 面板的抽屉(无遮罩 —— 它本身就是一页会话列表;X / 返回键 / 选中会话即关闭) */}
      {sessionListOpen && (
        <Animated.View
          style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.card }, drawerAnim]}
        >
          {/* 头部:标题 + 会话数 + 新建 + 关闭 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '700' }}>会话</Text>
            {sessions.length > 0 && (
              <Text variant="muted" style={{ fontSize: 12, marginRight: 2 }}>{sessions.length} 个</Text>
            )}
            <Pressable
              onPress={handleCreateSession}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: alpha(colors.primary, 0.35), backgroundColor: alpha(colors.primary, 0.08) }}
            >
              <Plus size={14} color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>新建</Text>
            </Pressable>
            <Pressable onPress={() => setSessionListOpen(false)} style={iconBtn}>
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>

          {sessionsLoading && sessions.length === 0 ? (
            <LoadingState paddingVertical={48} text="正在加载会话..." />
          ) : (
            <SectionList
              sections={sessionGroups}
              keyExtractor={(s) => s.id}
              stickySectionHeadersEnabled={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
              showsVerticalScrollIndicator={false}
              // 按「今天/昨天/日期」分组:与 web 端会话列表口径一致,长列表更好扫读
              renderSectionHeader={({ section }) => (
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.mutedForeground, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
                  {section.title}
                </Text>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, marginLeft: 16, backgroundColor: colors.hairline }} />}
              ListEmptyComponent={<Text variant="muted" style={{ textAlign: 'center', paddingVertical: 28, fontSize: 13 }}>暂无会话</Text>}
              renderItem={({ item: s }) => {
                const active = s.id === currentSessionId;
                return (
                  <Pressable
                    onPress={() => handleSelectSession(s.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingVertical: 13, paddingLeft: 16, paddingRight: 10,
                      // 当前会话:浅主色底 + 左侧主色竖条(比整块卡片更轻,长列表更清爽)
                      backgroundColor: active ? alpha(colors.primary, 0.07) : 'transparent',
                      borderLeftWidth: 3, borderLeftColor: active ? colors.primary : 'transparent',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: active ? '600' : '400', color: active ? colors.primary : colors.foreground }}>
                        {s.title || '新会话'}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 3 }}>{timeAgo(s.updatedAt)}</Text>
                    </View>
                    <Pressable
                      hitSlop={8}
                      onPress={() => { haptics.tap(); setSessionToDelete(s); }}
                      style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Trash2 size={15} color={colors.mutedForeground} />
                    </Pressable>
                  </Pressable>
                );
              }}
            />
          )}
        </Animated.View>
      )}

      {/* 导入弹窗:自定义来源选择(对齐 web DropdownMenu),选择后打开系统文件选择器 */}
      <FormSheet visible={importSheetOpen} title="导入账单" onClose={() => setImportSheetOpen(false)}>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
          选择账单来源，支持导出的 CSV / XLS / XLSX 文件
        </Text>
        <View style={{ gap: 8 }}>
          {IMPORT_AI_SOURCES.map((src) => {
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

      {/* 删除会话二次确认(聊天记录不可恢复;放在最后,确保盖在会话抽屉之上) */}
      <ConfirmSheet
        visible={!!sessionToDelete}
        title="删除会话"
        message={`确定删除「${sessionToDelete?.title || '新会话'}」吗？该会话的聊天记录会一并删除，且不可恢复。`}
        onConfirm={confirmDeleteSession}
        onClose={() => setSessionToDelete(null)}
      />
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

// ── Token 消耗展示(含前缀缓存命中率) ──
function UsageBadge({ usage }: { usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number } }) {
  const { colors } = useTheme();
  if (!usage || usage.totalTokens == null) return null;
  const cached = usage.cachedInputTokens ?? 0;
  const rate = cached > 0 ? Math.round((cached / Math.max(usage.inputTokens, 1)) * 100) : 0;
  return (
    <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
      共 {usage.totalTokens} tokens{cached > 0 ? ` · 缓存命中 ${rate}%` : ''}
    </Text>
  );
}

// ── 本轮上下文注入提示(折叠):日期/记忆/技能/附件清单 ──
function InjectChip({ injection }: { injection: ChatInjection }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const { date, memories, skills, hasAttachments, raw } = injection.summary;
  const parts = [
    date ? `日期 ${date}` : '',
    memories.length > 0 ? `${memories.length} 条记忆` : '',
    skills.length > 0 ? skills.join('、') : '',
    hasAttachments ? '附件清单' : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <View style={{ marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
      <Pressable
        hitSlop={6}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.muted }}
      >
        <Sparkles size={12} color={colors.mutedForeground} />
        {/* 注意:这里**不能**用 flex:1 —— 该行宽度按内容收缩(flexBasis 0 会被压成 0 宽),
            文案会整段消失(只剩图标和箭头)。用 flexShrink 让文案取内容宽度,过长才截断,
            与 ThinkingBlock 的写法一致 */}
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, color: colors.mutedForeground, fontWeight: '500' }}>
          本轮注入:{parts.join(' · ')}
        </Text>
        <ChevronDown size={12} color={colors.mutedForeground} style={{ marginLeft: 'auto', transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      {open && (
        <View style={{ padding: 10, gap: 6, backgroundColor: alpha(colors.foreground, 0.03) }}>
          {date ? <Text style={{ fontSize: 11, color: colors.mutedForeground }}>日期:{date}</Text> : null}
          {memories.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontWeight: '600' }}>记忆</Text>
              {memories.map((m, i) => (
                <Text key={i} style={{ fontSize: 11, color: colors.mutedForeground, lineHeight: 16 }}>· {m}</Text>
              ))}
            </View>
          ) : null}
          {skills.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontWeight: '600' }}>技能</Text>
              {skills.map((s, i) => (
                <Text key={i} style={{ fontSize: 11, color: colors.mutedForeground, lineHeight: 16 }}>· {s}</Text>
              ))}
            </View>
          ) : null}
          {hasAttachments ? <Text style={{ fontSize: 11, color: colors.mutedForeground }}>含附件清单(attachmentId / 文件名)</Text> : null}
          <Text style={{ fontSize: 10, color: colors.mutedForeground, lineHeight: 15 }}>{raw}</Text>
        </View>
      )}
    </View>
  );
}

// ── 思考块(折叠) ──
function ThinkingBlock({ block }: { block: Extract<MessageBlock, { type: 'thinking' }> }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
      <Pressable hitSlop={6} onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.muted }}>
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
