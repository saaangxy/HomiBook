import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Bot, Brain, Check, ChevronDown, ChevronUp, Loader2, Maximize2, Minimize2, Sparkles, Wrench, X } from 'lucide-react'
import { ChatWindow } from './ChatWindow'
import { useChatStore } from '@/stores/chat'
import { cn } from '@/lib/utils'

/**
 * 全局 AI 浮窗入口:右下角浮动按钮唤起可拖拽/可最大化的聊天窗。
 *
 * 关键约束:
 *   · 会话状态跨页保留 —— 组件挂在 MainLayout,切页不重建
 *   · 流式回复不中断 —— 关闭/最小化只隐藏(display:none),不卸载 ChatWindow
 *   · 位置与最大化状态存 localStorage,刷新后保持
 */

const STORAGE_KEY = 'ai-dock-prefs'
const DOCK_W = 720
const DOCK_H = 760
const MARGIN = 16
/** 底部给 Toast / 其他浮动元素留出空间 */
const BOTTOM_SAFE = 96

/**
 * 去掉 Markdown 标记,只留可读文本。
 *
 * 气泡是 3 行预览,不适合完整渲染 Markdown(标题/表格/列表会把高度撑乱),
 * 但直接把原始 `**` `##` 铺出来更难看,所以做一次轻量清洗。
 */
function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')          // 代码块
    .replace(/`([^`]+)`/g, '$1')              // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // 链接保留文字
    .replace(/^#{1,6}\s+/gm, '')              // 标题
    .replace(/^\s*[-*+]\s+/gm, '')            // 无序列表
    .replace(/^\s*\d+\.\s+/gm, '')            // 有序列表
    .replace(/^\s*>\s?/gm, '')                // 引用
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // 粗体
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')            // 斜体
    .replace(/(^|[^a-zA-Z0-9])_([^_]+)_/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')            // 删除线
    .replace(/\n+/g, ' ')                     // 换行折成空格,预览更连贯
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 气泡各状态的外观:图标 + 文案 + 配色(标签栏用) */
const KIND_META = {
  confirming: { icon: Bell, label: '等待确认', cls: 'text-amber-600', bg: 'bg-amber-50' },
  tool: { icon: Wrench, label: '正在执行', cls: 'text-primary', bg: 'bg-primary/5' },
  thinking: { icon: Brain, label: '思考中', cls: 'text-violet-500', bg: 'bg-violet-50' },
  text: { icon: Sparkles, label: '回复中', cls: 'text-emerald-600', bg: 'bg-emerald-50' },
  idle: { icon: Bot, label: '处理中', cls: 'text-muted-foreground', bg: 'bg-muted/40' },
} as const

interface DockPrefs {
  /** 浮窗左上角坐标;-1 表示尚未拖动过,默认停右下角 */
  x: number
  y: number
  /** 浮动按钮坐标;-1 表示尚未拖动过,默认右下角 */
  btnX: number
  btnY: number
  maximized: boolean
}

function loadPrefs(): DockPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<DockPrefs>
      return {
        x: typeof p.x === 'number' ? p.x : -1,
        y: typeof p.y === 'number' ? p.y : -1,
        btnX: typeof p.btnX === 'number' ? p.btnX : -1,
        btnY: typeof p.btnY === 'number' ? p.btnY : -1,
        maximized: !!p.maximized,
      }
    }
  } catch {
    /* 存储不可用(隐私模式)时按默认处理 */
  }
  return { x: -1, y: -1, btnX: -1, btnY: -1, maximized: false }
}

export function AssistantDock() {
  const [open, setOpen] = useState(false)
  /** 首次打开后才挂载 ChatWindow:避免每个页面一进来就拉会话列表 */
  const [mounted, setMounted] = useState(false)
  /**
   * 缓存聊天面板元素:父组件因拖动按钮/开关浮窗而重渲染时,
   * 这个元素引用不变,React 会跳过整棵 ChatWindow 子树的重算
   * (否则拖按钮时消息列表 + markdown 也会跟着重渲染)。
   */
  const chatBody = useMemo(() => <ChatWindow dock />, [])
  const [prefs, setPrefs] = useState<DockPrefs>(() => loadPrefs())
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const isStreaming = useChatStore((s) =>
    s.currentSessionId ? !!s.sessionCache[s.currentSessionId]?.isStreaming : false,
  )

  /** 当前流式消息的 blocks(工具/思考/正文都从这里取,字段是 content) */
  const readStreamBlocks = useCallback((): Array<Record<string, unknown>> => {
    const s = useChatStore.getState()
    const data = s.currentSessionId ? s.sessionCache[s.currentSessionId] : null
    if (!data) return []
    const msg = data.streamingMessageId
      ? data.allMessages.find((m) => m.id === data.streamingMessageId)
      : data.allMessages[data.allMessages.length - 1]
    return (msg?.blocks ?? []) as Array<Record<string, unknown>>
  }, [])

  /** 气泡状态:confirming(等确认) > tool(执行中) > thinking > text > idle */
  const streamKind = useChatStore((s) => {
    const data = s.currentSessionId ? s.sessionCache[s.currentSessionId] : null
    if (!data?.isStreaming) return 'idle'
    const msg = data.streamingMessageId
      ? data.allMessages.find((m) => m.id === data.streamingMessageId)
      : data.allMessages[data.allMessages.length - 1]
    const blocks = (msg?.blocks ?? []) as Array<Record<string, unknown>>
    // 正在执行/待确认的工具优先(此时模型确实在调工具)
    const tool = [...blocks].reverse().find(
      (b) => b.type === 'tool-call' && ['pending', 'running', 'confirming'].includes(String(b.status)),
    )
    if (tool) return tool.status === 'confirming' ? 'confirming' : 'tool'
    // 否则按**最后一个块**判断当前动作:思考中 / 回复中
    const last = blocks[blocks.length - 1]
    if (last?.type === 'thinking') return 'thinking'
    if (last?.type === 'text' && String(last.content ?? '').trim()) return 'text'
    return 'idle'
  })

  /** 气泡正文(不含状态前缀,由 UI 按 kind 加标签) */
  const streamPreview = useChatStore((s) => {
    const data = s.currentSessionId ? s.sessionCache[s.currentSessionId] : null
    if (!data?.isStreaming) return ''
    const msg = data.streamingMessageId
      ? data.allMessages.find((m) => m.id === data.streamingMessageId)
      : data.allMessages[data.allMessages.length - 1]
    if (!msg) return ''
    const blocks = (msg.blocks ?? []) as Array<Record<string, unknown>>

    // 与 streamKind 保持同一套判定:正在跑的 tool → 工具名;否则看最后一个块的内容
    const runningTool = [...blocks].reverse().find(
      (b) => b.type === 'tool-call' && ['pending', 'running', 'confirming'].includes(String(b.status)),
    )
    if (runningTool) return String(runningTool.displayName || runningTool.toolName || '工具调用')

    const last = blocks[blocks.length - 1]
    if (last?.type === 'thinking') {
      const content = stripMarkdown(String(last.content ?? ''))
      if (content) return content.length > 110 ? `…${content.slice(-110)}` : content
    }
    if (last?.type === 'text') {
      const content = stripMarkdown(String(last.content ?? ''))
      if (content) return content.length > 180 ? `…${content.slice(-180)}` : content
    }
    // 兜底:最近一次工具调用的名字(即使已完成,也让用户知道刚做了什么)
    const anyTool = [...blocks].reverse().find((b) => b.type === 'tool-call')
    if (anyTool) return String(anyTool.displayName || anyTool.toolName || '工具调用')
    return '正在准备…'
  })

  // 排查用:状态切换时打一次 blocks 概览,确认正文/工具块到底有没有进来
  const loggedKind = useRef('')
  useEffect(() => {
    if (streamKind === loggedKind.current) return
    loggedKind.current = streamKind
    const blocks = readStreamBlocks()
    console.log('[AssistantDock] kind=%s blocks=%o', streamKind, blocks)
  }, [streamKind, readStreamBlocks])

  /**
   * 是否有工具在等用户确认(角标变黄 + 铃铛)。
   * 不能要求 isStreaming:等待确认时流式已经停了,否则永远判成「已结束」显示绿勾。
   */
  const hasConfirming = useChatStore((s) => {
    const data = s.currentSessionId ? s.sessionCache[s.currentSessionId] : null
    if (!data?.allMessages?.length) return false
    const lastAssistant = [...data.allMessages].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return false
    return (lastAssistant.blocks as Array<Record<string, unknown>>).some(
      (b) => b.type === 'tool-call' && b.status === 'confirming',
    )
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      /* ignore */
    }
  }, [prefs])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (prefs.maximized) return
      // 标题栏右侧是按钮:在按钮上按下时不启动拖拽
      if ((e.target as HTMLElement).closest('button')) return
      const el = panelRef.current
      const rect = el?.getBoundingClientRect()
      if (!el || !rect) return

      // 固化成 left/top(默认是 right/bottom 定位),拖拽期间只改 transform
      el.style.left = `${rect.left}px`
      el.style.top = `${rect.top}px`
      el.style.right = 'auto'
      el.style.bottom = 'auto'
      el.style.willChange = 'transform'

      const start = { left: rect.left, top: rect.top, x: e.clientX, y: e.clientY }
      setDragging(true)

      /**
       * 用 window 监听,不用 setPointerCapture:
       * 组件重渲染后 capture 会失效,表现为「拖一下就停住」。
       */
      const onMove = (ev: PointerEvent) => {
        el.style.transform = `translate3d(${ev.clientX - start.x}px, ${ev.clientY - start.y}px, 0)`
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)

        // 两个捕获组都要抓完整数字:之前第二个写成 (-?) 只拿到负号,dy 变成 NaN → y 位置不更新
        const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(el.style.transform || '')
        const dx = m ? Number(m[1]) : 0
        const dy = m ? Number(m[2]) : 0
        const maxX = window.innerWidth - DOCK_W - MARGIN
        const maxY = window.innerHeight - 120
        const x = Math.min(Math.max(MARGIN, start.left + dx), Math.max(MARGIN, maxX))
        const y = Math.min(Math.max(MARGIN, start.top + dy), Math.max(MARGIN, maxY))

        el.style.transform = ''
        el.style.willChange = ''
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        setDragging(false)
        setPrefs((p) => ({ ...p, x, y }))
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      // 窄屏/触摸下浏览器可能把手势当滚动 → 发 pointercancel 而不再发 pointerup
      window.addEventListener('pointercancel', onUp)
    },
    [prefs.maximized],
  )

  /**
   * 最大化 / 还原时清掉拖拽留下的内联定位。
   *
   * 拖拽会把 left/top/right/bottom 直接写到元素上(为了走 transform 不 reflow),
   * 最大化依赖 className 的 inset-4;内联 left 优先级更高会让窗口从旧坐标开始、右侧超出屏幕。
   */
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (prefs.maximized) {
      el.style.left = ''
      el.style.top = ''
      el.style.right = ''
      el.style.bottom = ''
      el.style.width = ''
      el.style.height = ''
      el.style.transform = ''
    }
  }, [prefs.maximized])

  /**
   * Esc:最大化时先退出最大化,再次按下才关闭(避免误触丢失上下文);普通状态直接关闭。
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (prefs.maximized) {
        setPrefs((p) => ({ ...p, maximized: false }))
        return
      }
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, prefs.maximized])

  /**
   * 「点击外部关闭」改用遮罩层实现,不再用 document 监听:
   *   · 遮罩 z-index 低于浮窗,浮窗内点击不会命中遮罩
   *   · Radix 的下拉/气泡由 portal 渲染,层级在遮罩之上,点菜单项也不会误关
   *   · 只有真正点在浮窗之外才会触发
   * (之前用 contains 判断,点全屏按钮时 React 重渲染会让节点比对失效,直接把窗口关掉)
   */

  const positioned = prefs.x >= 0 && prefs.y >= 0
  const btnPositioned = prefs.btnX >= 0 && prefs.btnY >= 0
  /** 按钮在屏幕左半边:气泡改为向右展开,否则窄屏会越出左边界 */
  const bubbleOnLeft = btnPositioned && prefs.btnX < window.innerWidth / 2 - 80
  /** 按钮在上半屏:气泡改为向下展开,否则会越出上边界 */
  const bubbleBelow = btnPositioned && prefs.btnY < window.innerHeight / 2

  // 浮动按钮拖拽:位移超过 4px 才算拖动,否则视为点击打开
  const [btnDragging, setBtnDragging] = useState(false)
  /** 流式气泡是否展开(手动收起后不再自动弹出,直到下次回复或再点开) */
  const [bubbleOpen, setBubbleOpen] = useState(true)

  const onBtnPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const offX = e.clientX - rect.left
    const offY = e.clientY - rect.top
    const start = { x: e.clientX, y: e.clientY }
    setBtnDragging(true)

    // 与面板同一套:window 监听,不用 setPointerCapture(重渲染后 capture 会失效)
    const onMove = (ev: PointerEvent) => {
      const maxX = window.innerWidth - 56 - MARGIN
      const maxY = window.innerHeight - 56 - MARGIN
      const x = Math.min(Math.max(MARGIN, ev.clientX - offX), Math.max(MARGIN, maxX))
      const y = Math.min(Math.max(MARGIN, ev.clientY - offY), Math.max(MARGIN, maxY))
      setPrefs((p) => ({ ...p, btnX: x, btnY: y }))
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setBtnDragging(false)
      // 位移 > 4px 视为拖动,否则视为点击打开
      if (Math.abs(ev.clientX - start.x) > 4 || Math.abs(ev.clientY - start.y) > 4) return
      setMounted(true)
      setOpen(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  return (
    <>
      {/* 浮动按钮 + 流式气泡预览 */}
      {!open && (
        <div
          className="fixed z-50"
          style={btnPositioned ? { left: prefs.btnX, top: prefs.btnY } : { right: 24, bottom: 96 }}
        >
          {/* 实时回复预览:绝对定位在按钮上方,不改变容器尺寸(拖拽坐标才准)。
              该轮如果以工具调用为主(没有 text 块),退化为「正在处理…」,不然气泡会整个消失 */}
          {isStreaming && bubbleOpen && (() => {
            const meta = KIND_META[streamKind as keyof typeof KIND_META] ?? KIND_META.idle
            const KindIcon = meta.icon
            return (
              <div
                className={cn(
                  'absolute w-[min(320px,calc(100vw-40px))] overflow-hidden rounded-2xl border border-border bg-card shadow-lg',
                  // 上下:按钮在上半屏时向下展开,否则向上;气泡紧贴主按钮(切换按钮在对面)
                  bubbleBelow ? 'top-full mt-3' : 'bottom-full mb-3',
                  // 左右:按钮在左半边时向右展开,否则向左
                  bubbleOnLeft ? 'left-0' : 'right-0',
                  // 靠近按钮的那个角切平,视觉上像"从按钮长出来"
                  bubbleBelow
                    ? bubbleOnLeft ? 'rounded-tl-sm' : 'rounded-tr-sm'
                    : bubbleOnLeft ? 'rounded-bl-sm' : 'rounded-br-sm',
                )}
              >
                {/* 状态标签栏 */}
                <div className={cn('flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5', meta.bg)}>
                  <KindIcon size={12} className={meta.cls} />
                  <span className={cn('text-[10px] font-medium tracking-wide', meta.cls)}>{meta.label}</span>
                  <span className="ml-auto inline-flex items-end gap-0.5 pb-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:300ms]" />
                  </span>
                </div>
                {/* 内容预览 */}
                <p className="px-3 py-2 text-xs leading-relaxed text-foreground/85 line-clamp-3">
                  {streamPreview}
                </p>
                {/* 小尖角指向按钮:气泡在下方时尖角朝上,反之朝下 */}
                <span
                  className={cn(
                    'absolute h-2.5 w-2.5 rotate-45 border-border bg-card',
                    bubbleBelow ? '-top-1 border-l border-t' : '-bottom-1 border-b border-r',
                    bubbleOnLeft ? 'left-5' : 'right-5',
                  )}
                />
              </div>
            )
          })()}

          {/* 气泡展开/收起:贴在按钮内侧,随四向规则一起翻面 */}
          {isStreaming && (
            <button
              type="button"
              onClick={() => setBubbleOpen((v) => !v)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={bubbleOpen ? '收起预览' : '展开预览'}
              title={bubbleOpen ? '收起预览' : '展开预览'}
              className={cn(
                // 与右上角状态角标完全对称:同 20px、同外扩 4px(-left-1 / -top-1);
                // z-20 压在气泡之上(气泡从上方展开时会盖住这一角),保证始终可点
                'absolute -left-1 -top-1 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground',
              )}
            >
              {bubbleOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </button>
          )}

          <button
            type="button"
            onPointerDown={onBtnPointerDown}
            aria-label="打开 AI 助手（可拖动）"
            title="点击打开 / 拖动调整位置"
            className={cn(
              // touch-none:同上,避免触摸拖动被浏览器判为滚动
              'relative flex h-14 w-14 touch-none items-center justify-center rounded-full',
              'bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95',
              btnDragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            <Bot size={22} />
            {isStreaming && (
              <span className="pointer-events-none absolute -inset-1 animate-ping rounded-full border-2 border-primary/40" />
            )}
            {/* 状态角标:待确认 > 输出中 > 已结束 */}
            <span
              className={cn(
                // 与左上角切换按钮对称:同 20px、同外扩 4px(恢复到原来的角标位置)
                'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background shadow-sm',
                hasConfirming ? 'bg-amber-500' : isStreaming ? 'bg-primary' : 'bg-emerald-500',
              )}
              title={hasConfirming ? '有待确认操作' : isStreaming ? '输出中' : '已结束'}
            >
              {hasConfirming ? (
                <Bell size={11} className="text-white" />
              ) : isStreaming ? (
                <Loader2 size={11} className="animate-spin text-white" />
              ) : (
                <Check size={11} className="text-white" />
              )}
            </span>
          </button>
        </div>
      )}

      {/* 遮罩:只在打开时出现;z-40 低于浮窗(z-50),所以点窗口内部/标题按钮/窗口内菜单都不会命中它,
          Radix 下拉菜单 portal 后层级默认更高,也不会被遮罩挡住 */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 浮窗:display 控制显隐,组件始终挂载 → 流式不中断 */}
      <div
        ref={panelRef}
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl',
          !open && 'hidden',
          prefs.maximized && 'inset-4',
          dragging && 'select-none',
        )}
        style={
          prefs.maximized
            ? undefined
            : {
                width: DOCK_W,
                maxWidth: 'calc(100vw - 32px)',
                height: `min(${DOCK_H}px, 80vh)`,
                ...(positioned ? { left: prefs.x, top: prefs.y } : { right: 24, bottom: BOTTOM_SAFE }),
              }
        }
      >
        {/* 标题栏:拖拽手柄 */}
        <div
          onPointerDown={onPointerDown}
          className={cn(
            // touch-none:阻止触摸/移动模拟下浏览器把拖动当滚动接管(touch-action: none)
            'flex shrink-0 touch-none items-center gap-2 border-b border-border bg-muted/40 px-3 py-2',
            !prefs.maximized && 'cursor-move',
          )}
        >
          <Bot size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">AI 助手</span>
          {isStreaming && <span className="text-[10px] text-muted-foreground">回复中…</span>}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label={prefs.maximized ? '还原' : '最大化'}
              onClick={() => setPrefs((p) => ({ ...p, maximized: !p.maximized }))}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {prefs.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 内容区:必须是 flex 容器,ChatWindow 的 flex-1 才吃得到高度(否则输入区被挤出可视区) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mounted ? chatBody : null}
        </div>
      </div>
    </>
  )
}
