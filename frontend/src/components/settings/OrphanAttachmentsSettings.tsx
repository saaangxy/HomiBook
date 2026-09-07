import { useState } from 'react'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { settingsApi } from '@/api/settings'
import { Check, FolderOpen, FileSearch, Trash2 } from 'lucide-react'

// 附件管理：无效附件查询与清理（仅管理员可见）
export function OrphanAttachmentsSettings() {
  const [orphansLoading, setOrphansLoading] = useState(false)
  const [orphansCleaning, setOrphansCleaning] = useState(false)
  const [orphansError, setOrphansError] = useState('')
  const [orphansResult, setOrphansResult] = useState<{ count: number; files: number } | null>(null)
  const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
  const [cleanResult, setCleanResult] = useState<{ deletedFiles: number; deletedRecords: number } | null>(null)

  // 查询无效附件
  const handleQueryOrphans = async () => {
    setOrphansLoading(true)
    setOrphansError('')
    setOrphansResult(null)
    setCleanResult(null)
    try {
      const items = await settingsApi.getOrphanAttachments()
      const files = items.filter((i) => i.fileExists).length
      setOrphansResult({ count: items.length, files })
    } catch (e: any) {
      setOrphansError(e.message)
    } finally {
      setOrphansLoading(false)
    }
  }

  // 清理无效附件
  const handleCleanOrphans = async () => {
    setCleanConfirmOpen(false)
    setOrphansCleaning(true)
    setOrphansError('')
    try {
      const result = await settingsApi.cleanOrphanAttachments()
      setCleanResult({ deletedFiles: result.deletedFiles, deletedRecords: result.deletedRecords })
      setOrphansResult(null)
    } catch (e: any) {
      setOrphansError(e.message)
    } finally {
      setOrphansCleaning(false)
    }
  }

  return (
    <>
      <AccordionItem value="attachments" className="border rounded-xl px-5">
        <AccordionTrigger className="text-base font-semibold hover:no-underline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <FolderOpen size={16} className="text-primary-foreground" />
            </div>
            附件管理
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-5">
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">
                无效附件包括：上传后未关联到流水的文件（如编辑弹窗中放弃提交的附件），以及数据库记录已删除但文件仍残留的孤儿文件。
                清理无效附件可释放磁盘空间。
              </p>
            </div>

            {orphansError && (
              <Alert variant="destructive">
                <AlertDescription>{orphansError}</AlertDescription>
              </Alert>
            )}

            {orphansResult !== null && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <FileSearch size={18} className="text-muted-foreground" />
                <span className="text-sm">
                  共 <strong>{orphansResult.count}</strong> 条记录（
                  <strong>{orphansResult.files}</strong> 个文件存在于磁盘）
                </span>
              </div>
            )}

            {cleanResult !== null && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30">
                <Check size={18} className="text-[#22c55e]" />
                <span className="text-sm">
                  已清理 <strong>{cleanResult.deletedFiles}</strong> 个文件、
                  <strong>{cleanResult.deletedRecords}</strong> 条数据库记录
                </span>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleQueryOrphans}
                disabled={orphansLoading}
              >
                {orphansLoading ? '查询中...' : '查询无效附件'}
              </Button>
              <Button
                size="sm"
                onClick={() => setCleanConfirmOpen(true)}
                disabled={orphansCleaning || orphansResult === null || orphansResult.count === 0}
                className="bg-[#ef4444] hover:bg-[#dc2626] text-white"
              >
                <Trash2 size={14} className="mr-1" />
                {orphansCleaning ? '清理中...' : '清理所有无效附件'}
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 清理无效附件确认弹窗 */}
      <AlertDialog open={cleanConfirmOpen} onOpenChange={setCleanConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清理无效附件</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除所有无效附件吗？此操作不可撤销，将永久删除
              <strong className="text-[#ef4444]"> {orphansResult?.files ?? 0} </strong>
              个磁盘文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#ef4444] hover:bg-[#dc2626]"
              onClick={handleCleanOrphans}
            >
              确认清理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
