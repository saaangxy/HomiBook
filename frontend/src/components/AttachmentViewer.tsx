import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Download, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'

export interface AttachmentItem {
  id: string
  url: string
  originalFilename: string
}

interface AttachmentViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  attachments: AttachmentItem[]
}

function getFullUrl(url: string): string {
  if (url.startsWith('http')) return url
  return window.location.origin + (url.startsWith('/') ? url : '/' + url)
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(url)
}

async function downloadFile(url: string, filename: string) {
  try {
    const relativePath = url.includes('/api/uploads/')
      ? `/api/uploads/${url.split('/api/uploads/').pop()}`
      : url
    const downloadUrl = `/api/records/download?path=${encodeURIComponent(relativePath)}&name=${encodeURIComponent(filename)}`

    const token = (() => {
      try {
        const raw = localStorage.getItem('auth-storage')
        if (!raw) return null
        return JSON.parse(raw)?.state?.token || null
      } catch { return null }
    })()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(downloadUrl, { headers })
    if (!res.ok) throw new Error('下载失败')
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  } catch { /* ignore */ }
}

export function AttachmentViewer({ open, onOpenChange, attachments }: AttachmentViewerProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const imageAreaRef = useRef<HTMLDivElement>(null)
  const previewingRef = useRef(false)
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 5
  const ZOOM_STEP = 0.25

  const isPreviewing = previewImage !== null
  previewingRef.current = isPreviewing

  useEffect(() => {
    setZoom(1)
  }, [previewImage])

  const closePreview = useCallback(() => {
    setPreviewImage(null)
    setZoom(1)
  }, [])

  // 拦截关闭：预览模式先关预览，不关 Dialog
  const handleOpenChange = useCallback((willOpen: boolean) => {
    if (!willOpen && previewingRef.current) {
      closePreview()
      return
    }
    onOpenChange(willOpen)
  }, [onOpenChange, closePreview])

  // 原生 wheel 事件，passive: false 让 preventDefault 生效
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - e.deltaY * 0.002)))
  }, [])

  useEffect(() => {
    const el = imageAreaRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel, isPreviewing])

  // ESC 键：预览模式下先关预览
  const handleEscapeKeyDown = useCallback((e: KeyboardEvent) => {
    if (isPreviewing) {
      e.preventDefault()
      closePreview()
    }
  }, [isPreviewing, closePreview])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={isPreviewing ? '[&>button:last-child]:hidden' : 'max-w-lg'}
        style={isPreviewing ? {
          maxWidth: '100vw',
          width: '100vw',
          height: '100vh',
          borderRadius: 0,
          padding: 0,
          gap: 0,
          border: 'none',
          backgroundColor: 'rgba(0,0,0,0.95)',
          top: 0,
          left: 0,
          transform: 'none',
          translate: 'none',
          boxShadow: 'none',
        } : undefined}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        {/* 图片全屏预览 */}
        {isPreviewing ? (
          <div className="w-full h-full flex flex-col" onClick={closePreview}>
            {/* 顶部工具栏 */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <span className="text-white/60 text-xs tabular-nums min-w-[40px] text-center select-none">
                {Math.round(zoom * 100)}%
              </span>
              <button
                className="h-8 w-8 flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
              >
                <ZoomIn size={16} />
              </button>
              <button
                className="h-8 w-8 flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
              >
                <ZoomOut size={16} />
              </button>
              <button
                className="h-8 w-8 flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30"
                onClick={() => setZoom(1)}
                disabled={zoom === 1}
              >
                <RotateCcw size={14} />
              </button>
              <button
                className="h-8 px-2 flex items-center gap-1 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => {
                  const att = attachments.find((a) => getFullUrl(a.url) === previewImage)
                  downloadFile(previewImage!, att?.originalFilename || '图片.png')
                }}
              >
                <Download size={14} />下载
              </button>
              <button
                className="h-8 px-2 flex items-center gap-1 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/10"
                onClick={closePreview}
              >
                <X size={14} />关闭
              </button>
            </div>

            {/* 图片区域 */}
            <div
              ref={imageAreaRef}
              className="flex-1 flex items-center justify-center overflow-hidden p-12"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={previewImage!}
                alt="预览"
                className="max-h-full max-w-full object-contain rounded-lg select-none"
                style={{ transform: `scale(${zoom})`, cursor: zoom !== 1 ? 'grab' : 'default' }}
                draggable={false}
              />
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {attachments.length === 0 ? '查看附件' : `查看附件 (${attachments.length})`}
              </DialogTitle>
            </DialogHeader>
            {attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无附件</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {attachments.map((att) => {
                  const fullUrl = getFullUrl(att.url)
                  const isImage = isImageUrl(att.url)
                  return (
                    <div key={att.id} className="relative group">
                      {isImage ? (
                        <button
                          className="w-20 h-20 rounded-lg border border-border overflow-hidden hover:ring-2 hover:ring-[#f97316]/50 transition-all"
                          onClick={() => setPreviewImage(fullUrl)}
                        >
                          <img
                            src={fullUrl}
                            alt={att.originalFilename}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="w-20 h-20 rounded-lg border border-border bg-muted flex flex-col items-center justify-center gap-1 p-1">
                          <span className="text-[10px] text-muted-foreground text-center leading-tight break-all line-clamp-2">
                            {att.originalFilename}
                          </span>
                        </div>
                      )}
                      <button
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#3b82f6] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        onClick={(e) => { e.stopPropagation(); downloadFile(att.url, att.originalFilename) }}
                      >
                        <Download size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
