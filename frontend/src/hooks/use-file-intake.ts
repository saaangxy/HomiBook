import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react'

/** 单个附件体积上限（与导入向导文案里的 10MB 保持一致） */
export const MAX_ATTACH_MB = 10
export const MAX_ATTACH_BYTES = MAX_ATTACH_MB * 1024 * 1024

export interface FileIntakeOptions {
  /** false = 忽略选择/拖拽/粘贴（弹窗关闭、上传中、AI 正在输出等） */
  enabled?: boolean
  /** 单文件体积上限，默认 10MB */
  maxBytes?: number
  /** 拖拽与文件选择接收的文件，缺省全部 */
  acceptFiles?: (file: File) => boolean
  /** 粘贴接收的文件，缺省全部（AI 聊天窗只认图片） */
  acceptPaste?: (file: File) => boolean
  /** 通过校验的文件 */
  onFiles: (files: File[]) => void
  /** 体积超限的文件（提示文案由调用方决定） */
  onOversized?: (files: File[]) => void
}

export interface FileIntake {
  /** 是否有文件正悬停在放置区上方 */
  dragOver: boolean
  /** 绑定到放置区容器（整个弹窗 / 整个聊天窗） */
  dragHandlers: {
    onDragOver: (e: ReactDragEvent) => void
    onDragLeave: (e: ReactDragEvent) => void
    onDrop: (e: ReactDragEvent) => void
  }
  /** 可绑定到 onPaste，也可由调用方挂到 document（弹窗内任意输入框都能粘） */
  handlePaste: (e: ReactClipboardEvent<Element> | ClipboardEvent) => void
  /** 文件选择框复用同一套过滤与体积校验 */
  intakeFiles: (files: File[]) => void
}

/**
 * 附件录入三入口（选择 / 拖拽 / 粘贴）共用的判定逻辑。
 *
 * 三个容易写错的地方集中在这里，避免各组件复制后漂移：
 * - 拖拽只看 dataTransfer.types 是否含 Files（否则拖选中的文字也会高亮）
 * - dragleave 用 contains(relatedTarget) 判断是否真的离开（进入子元素也会触发）
 * - 粘贴优先 clipboardData.files，为空才回退 items（两者是同一批文件，相加会重复）
 * - 只有确实收到可接收的文件才 preventDefault（否则纯文本粘贴会被吞掉）
 */
export function useFileIntake(options: FileIntakeOptions): FileIntake {
  const [dragOverState, setDragOver] = useState(false)
  // 回调用 ref 读最新配置：避免每次 render 重建 handler 导致 document 监听反复重绑
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const emit = useCallback((raw: File[], source: 'select' | 'paste'): boolean => {
    const opts = optionsRef.current
    if (opts.enabled === false) return false
    const accept = source === 'paste' ? opts.acceptPaste : opts.acceptFiles
    const accepted = accept ? raw.filter(accept) : raw
    if (accepted.length === 0) return false

    const maxBytes = opts.maxBytes ?? MAX_ATTACH_BYTES
    const oversized = accepted.filter((f) => f.size > maxBytes)
    const valid = accepted.filter((f) => f.size <= maxBytes)
    // 先交付正常文件再报超限，调用方在 onFiles 里清空旧提示时不会把本次提示冲掉
    if (valid.length > 0) opts.onFiles(valid)
    if (oversized.length > 0) opts.onOversized?.(oversized)
    return true
  }, [])

  const intakeFiles = useCallback((files: File[]) => {
    emit(files, 'select')
  }, [emit])

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (optionsRef.current.enabled === false) return
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    // 进入子元素同样会触发 dragleave：只有真正离开容器才收起提示
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])

  const onDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    setDragOver(false)
    emit(Array.from(e.dataTransfer?.files || []), 'select')
  }, [emit])

  const handlePaste = useCallback((e: ReactClipboardEvent<Element> | ClipboardEvent) => {
    const dt = e.clipboardData
    if (!dt) return
    // files 与 items 指向同一批文件，不能相加（否则一张变两张）；只有 files 为空时才回退 items
    const fromFiles = Array.from(dt.files || [])
    const files = fromFiles.length > 0
      ? fromFiles
      : Array.from(dt.items || [])
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f)
    if (files.length === 0) return
    if (emit(files, 'paste')) e.preventDefault()
  }, [emit])

  return {
    // 禁用时不展示高亮：弹窗关闭/上传中不会再响应新的拖拽
    dragOver: options.enabled !== false && dragOverState,
    dragHandlers: { onDragOver, onDragLeave, onDrop },
    handlePaste,
    intakeFiles,
  }
}
