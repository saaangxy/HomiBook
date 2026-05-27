import { useState, useCallback, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 5
  const ZOOM_STEP = 0.25

  useEffect(() => {
    setZoom(1)
  }, [previewImage])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - e.deltaY * 0.002)))
  }, [])

  if (attachments.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>查看附件</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground text-center py-8">暂无附件</p>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>查看附件 ({attachments.length})</DialogTitle>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>

      {/* 图片预览 */}
      {previewImage && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" onClick={() => { setPreviewImage(null); setZoom(1) }}>
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
              onClick={(e) => {
                e.stopPropagation()
                const att = attachments.find((a) => getFullUrl(a.url) === previewImage)
                downloadFile(previewImage, att?.originalFilename || '图片.png')
              }}
            >
              <Download size={14} />下载
            </button>
            <button
              className="h-8 px-2 flex items-center gap-1 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/10"
              onClick={(e) => { e.stopPropagation(); setPreviewImage(null); setZoom(1) }}
            >
              <X size={14} />关闭
            </button>
          </div>

          {/* 图片区域 */}
          <div
            className="flex-1 flex items-center justify-center overflow-hidden p-12"
            onWheel={handleWheel}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage}
              alt="预览"
              className="max-h-full max-w-full object-contain rounded-lg select-none"
              style={{ transform: `scale(${zoom})`, cursor: zoom !== 1 ? 'grab' : 'default' }}
              draggable={false}
            />
          </div>
        </div>
      )}
    </>
  )
}
