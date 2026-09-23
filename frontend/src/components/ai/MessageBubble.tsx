import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { Message, MessageBlock } from '@/stores/chat'
import { parseImportMessage, type ChatInjection } from '@homibook/core'
import { useAuthStore } from '@/stores/auth'
import { ToolCallCard } from './ToolCallCard'
import { Bot, Brain, ChevronDown, ChevronLeft, ChevronRight, Copy, FileSpreadsheet, FileText, RefreshCw, Pencil, Check, Loader2, Sparkles } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

/** 图片扩展名(与 RecordFormDialog / AttachmentViewer 同一份判定) */
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|bmp)$/i

/** 附件是不是图片:原文件名与 URL 任一命中即按图片渲染 */
function isImageAttachment(att: { url: string; originalFilename: string }): boolean {
  return IMAGE_EXT_RE.test(att.originalFilename || '') || IMAGE_EXT_RE.test(att.url || '')
}

interface Props {
  message: Message
  onRetry?: () => void
  onEditSubmit?: (msgId: string, newText: string) => void
  versions?: { id: string; label: string; isActive: boolean }[]
  onSwitchVersion?: (versionId: string) => void
}

/**
 * 本轮上下文注入提示:告诉用户「这轮给模型补了什么上下文」(日期/记忆/技能/附件清单)。
 * 这些内容为保持前缀缓存而只在有变化时追加注入、不进入对话正文,故单独折叠展示。
 */
function InjectChip({ injection }: { injection: ChatInjection }) {
  const [open, setOpen] = useState(false)
  const { date, memories, skills, hasAttachments, raw } = injection.summary
  const parts = [
    date ? `日期 ${date}` : '',
    memories.length > 0 ? `${memories.length} 条记忆` : '',
    skills.length > 0 ? skills.join('、') : '',
    hasAttachments ? '附件清单' : '',
  ].filter(Boolean)
  if (parts.length === 0) return null

  return (
    <div className="border rounded-lg overflow-hidden text-xs max-w-full text-left">
      <button
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={12} />
        <span className="truncate">本轮注入:{parts.join(' · ')}</span>
        <ChevronDown size={12} className={cn('ml-auto shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-2.5 py-2 border-t space-y-1.5 text-muted-foreground break-words">
          {date && <div>日期:{date}</div>}
          {memories.length > 0 && (
            <div>
              <div className="text-foreground/70 font-medium">记忆</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {memories.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {skills.length > 0 && (
            <div>
              <div className="text-foreground/70 font-medium">技能</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {skills.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {hasAttachments && <div>含附件清单(attachmentId / 文件名)</div>}
          <details>
            <summary className="cursor-pointer select-none">原始注入文本</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-relaxed">{raw}</pre>
          </details>
        </div>
      )}
    </div>
  )
}

/** 获取消息的全部文本内容 */
export function getMessageText(message: Message): string {
  return message.blocks
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
}

export function MessageBubble({ message, onRetry, onEditSubmit, versions, onSwitchVersion }: Props) {
  const user = useAuthStore((s) => s.user)
  const userInitial = (user?.nickname || user?.username || '用')[0]

  const isUser = message.role === 'user'
  const [openThinkBlocks, setOpenThinkBlocks] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')

  const isStreaming = message.isStreaming
  const isEmpty = !isUser && isStreaming && message.blocks.length === 0

  /** 思考过程**默认折叠**（流式期间也不自动展开）：展开与否只由用户点击决定，与移动端一致 */
  const toggleThink = (id: string) => {
    setOpenThinkBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleStartEdit = () => {
    setEditText(getMessageText(message))
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditText('')
  }

  const handleSubmitEdit = () => {
    const trimmed = editText.trim()
    if (trimmed && onEditSubmit) {
      onEditSubmit(message.id, trimmed)
    }
    setIsEditing(false)
    setEditText('')
  }

  const handleCopy = async () => {
    const text = getMessageText(message)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn('flex gap-3 group', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      <Avatar className={cn('w-8 h-8 shrink-0 rounded-lg', isUser ? 'bg-gradient-to-br from-primary to-primary/40' : 'bg-muted')}>
        <AvatarFallback className={cn('text-xs font-medium', isUser ? 'text-primary-foreground bg-transparent' : 'text-foreground')}>
          {isUser ? userInitial : <Bot size={14} />}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex flex-col gap-2 min-w-0', isUser ? 'items-end' : 'items-start min-w-[60%]', isEditing ? 'w-[60%]' : 'max-w-[75%]')}>
        {isUser ? (
          <>
            {/* 版本切换 */}
            {versions && versions.length > 1 && onSwitchVersion && (() => {
              const curIdx = versions.findIndex((v) => v.isActive)
              const total = versions.length
              return (
                <div className="flex items-center gap-1 mb-1">
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={curIdx <= 0}
                    onClick={() => onSwitchVersion(versions[curIdx - 1].id)}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-muted-foreground font-medium min-w-[36px] text-center select-none">
                    {curIdx + 1}/{total}
                  </span>
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={curIdx >= total - 1}
                    onClick={() => onSwitchVersion(versions[curIdx + 1].id)}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )
            })()}
            {isEditing ? (
              <>
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="bg-white border rounded-2xl rounded-tr-md px-4 py-2.5 text-sm w-full resize-none min-h-[60px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:ring-1"
                  placeholder="输入消息..."
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmitEdit()
                    } else if (e.key === 'Escape') {
                      handleCancelEdit()
                    }
                  }}
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={handleCancelEdit}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={handleSubmitEdit}
                    disabled={!editText.trim()}
                  >
                    发送
                  </Button>
                </div>
              </>
            ) : (
              message.blocks.map((block) => {
                if (block.type === 'text' && !block.content.trim()) return null
                // 旧版导入消息(v1,把 fileId/source/文件名 编码在文本里)渲染为文件卡片,仅保留描述文本;
                // 新版导入消息只含一句「请导入XX账单文件」,这里返回 null,按普通文本渲染,文件由 attachments 渲染
                const importMeta = block.type === 'text' ? parseImportMessage(block.content) : null
                return (
                <div key={block.id} className="space-y-1.5 max-w-full">
                  <div
                    className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words max-w-full"
                  >
                    {block.type === 'text' ? (importMeta ? importMeta.desc : block.content) : ''}
                  </div>
                  {importMeta && (
                    <div className="flex items-center gap-2.5 bg-primary/90 text-primary-foreground rounded-xl px-3.5 py-2.5">
                      <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                        <FileSpreadsheet size={17} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{importMeta.fileName}</p>
                        <p className="text-xs opacity-75 mt-0.5">{importMeta.source}账单 · 待导入</p>
                      </div>
                    </div>
                  )}
                </div>
              )})
            )}
            {/* 附件展示:图片给缩略图,其余(csv / Excel / pdf…)给文件条 ——
                非图片当 <img> 渲染只会出坏图,这里按扩展名分流 */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {message.attachments.map((att) => (
                  isImageAttachment(att) ? (
                    <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" title={att.originalFilename}>
                      <img
                        src={att.url}
                        alt={att.originalFilename}
                        className="w-20 h-20 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                      />
                    </a>
                  ) : (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={att.originalFilename}
                      className="flex items-center gap-2 max-w-[220px] rounded-lg border bg-card px-2.5 py-2 hover:bg-muted/50 transition-colors"
                    >
                      <span className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <FileText size={15} className="text-muted-foreground" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs truncate">{att.originalFilename}</span>
                        <span className="block text-[10px] text-muted-foreground">附件</span>
                      </span>
                    </a>
                  )
                ))}
              </div>
            )}
            {/* 上下文注入(日期/记忆/技能/附件清单):仅在此处展示,不属于对话正文 */}
            {message.injections?.map((injection) => (
              <InjectChip key={injection.id} injection={injection} />
            ))}
          </>
        ) : (
          <div className="space-y-2 min-w-0 w-full">
            {/* 加载状态：流式但还没有任何 block */}
            {isEmpty && (
              <div className="bg-muted/60 rounded-2xl rounded-tl-md px-4 py-3 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                思考中...
              </div>
            )}

            {message.blocks.map((block) => {
              switch (block.type) {
                case 'thinking': {
                  const isOpen = openThinkBlocks.has(block.id)
                  return (
                    <div key={block.id} className="border rounded-lg overflow-hidden text-xs max-w-full">
                      <button
                        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-muted-foreground hover:bg-muted/50 transition-colors"
                        onClick={() => toggleThink(block.id)}
                      >
                        <Brain size={12} />
                        <span>思考过程</span>
                        <ChevronDown size={12} className={cn('ml-auto transition-transform', isOpen && 'rotate-180')} />
                      </button>
                      {isOpen && (
                        <div className="px-3 py-2 border-t whitespace-pre-wrap text-muted-foreground break-words">
                          {block.content}
                        </div>
                      )}
                    </div>
                  )
                }
                case 'text': {
                  return (
                    <div
                      key={block.id}
                      className="bg-muted/60 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed break-words markdown-body max-w-full overflow-x-auto"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {block.content}
                      </ReactMarkdown>
                    </div>
                  )
                }
                case 'tool-call':
                  return <ToolCallCard key={block.id} toolCall={block} />
                default:
                  return null
              }
            })}

            {/* 操作按钮 —— 仅非流式时显示 */}
            {!isStreaming && (
              <div className="flex items-center gap-1">
                <button
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                  onClick={handleCopy}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制'}
                </button>
                {onRetry && (
                  <button
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    onClick={onRetry}
                  >
                    <RefreshCw size={12} />
                    重试
                  </button>
                )}
              </div>
            )}

            {/* Token 消耗展示 */}
            {!isStreaming && message.usage && message.usage.inputTokens != null && (
              <div className="text-xs text-muted-foreground/60">
                Token: ↑{message.usage.inputTokens.toLocaleString()} + ↓{message.usage.outputTokens?.toLocaleString() ?? 0} = {message.usage.totalTokens?.toLocaleString() ?? 0}
                {message.usage.cachedInputTokens != null && message.usage.cachedInputTokens > 0 && (
                  <>
                    {' '}| 缓存命中 {message.usage.cachedInputTokens.toLocaleString()}
                    （{Math.round((message.usage.cachedInputTokens / Math.max(message.usage.inputTokens, 1)) * 100)}%）
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 用户消息操作按钮 */}
        {isUser && !isStreaming && !isEditing && onEditSubmit && (
          <div className="flex items-center gap-1">
            <button
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              onClick={handleCopy}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              onClick={handleStartEdit}
            >
              <Pencil size={12} />
              编辑
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
