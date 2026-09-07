import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { X, Download, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { DictCombobox } from '@/components/DictCombobox'
import { TagCombobox } from '@/components/TagCombobox'
import { recordApi } from '@/api/record'
import { accountLabel } from '@/lib/account'
import type { AccountItem } from '@/api/account'
import type { BookMember } from '@/api/book'
import { RECORD_TYPE_LABELS, RECORD_TYPE_TEXT_CLASS } from '@/lib/record-type'
import type { RecordItem, RecordType } from '@/api/record'

interface Props {
  open: boolean
  /** 非空 = 编辑模式 */
  editRecord: RecordItem | null
  currentBookId: string
  accounts: AccountItem[]
  multiOwnerAccounts: boolean
  bookMembers: BookMember[]
  onClose: () => void
  /** 保存成功回调:refreshRecords 表示需要刷新记录列表(编辑会改记录本身) */
  onSaved: (refreshRecords: boolean) => void
}

function getCategoryGroup(type: RecordType) {
  if (type === 'INCOME') return 'transaction_category_income'
  if (type === 'EXPENSE') return 'transaction_category_expense'
  return 'transaction_category_transfer'
}

/** 记一笔/编辑流水弹窗(含附件上传与图片预览)。从 RecordsPage 拆出。 */
export function RecordFormDialog({ open, editRecord, currentBookId, accounts, multiOwnerAccounts, bookMembers, onClose, onSaved }: Props) {
  const [formType, setFormType] = useState<RecordType>('EXPENSE')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formFromAccountId, setFormFromAccountId] = useState('')
  const [formToAccountId, setFormToAccountId] = useState('')
  const [formCategoryCode, setFormCategoryCode] = useState('')
  const [formPayer, setFormPayer] = useState('')
  const [formRemark, setFormRemark] = useState('')
  const [formTags, setFormTags] = useState<string[]>([])
  const [formOwnerId, setFormOwnerId] = useState('__self__')
  const [formAttachments, setFormAttachments] = useState<{ id: string; url: string; fullUrl: string; originalFilename: string }[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 打开时回填:编辑模式带出记录,新建模式给默认值(原 openEdit/openCreate 逻辑)
  useEffect(() => {
    if (!open) return
    if (editRecord) {
      const record = editRecord
      setFormType(record.type)
      setFormAmount(record.amount.toString())
      setFormDate(dayjs(record.date).format('YYYY-MM-DDTHH:mm:ss'))
      setFormAccountId(record.accountId)
      setFormFromAccountId(record.fromAccountId || '')
      setFormToAccountId(record.toAccountId || '')
      setFormCategoryCode(record.categoryCode || '')
      setFormPayer(record.payer || '')
      setFormRemark(record.remark || '')
      setFormTags(record.tags || [])
      setFormOwnerId(record.ownerId || '__self__')
      // 附件数据已包含 id + url + originalFilename，补 fullUrl
      const origin = window.location.origin
      setFormAttachments(record.attachments.map((a) => {
        const fullUrl = a.url.startsWith('http') ? a.url : `${origin}${a.url}`
        return { id: a.id, url: a.url, fullUrl, originalFilename: a.originalFilename }
      }))
      setFormError('')
      setSubmitting(false)
    } else {
      setFormType('EXPENSE')
      setFormAmount('')
      setFormDate(dayjs().format('YYYY-MM-DDTHH:mm:ss'))
      setFormAccountId('')
      setFormFromAccountId('')
      setFormToAccountId('')
      setFormCategoryCode('')
      setFormPayer('')
      setFormRemark('')
      setFormOwnerId('__self__')
      setFormAttachments([])
      setFormTags([])
      setFormError('')
      setSubmitting(false)
    }
  }, [open, editRecord])

  const handleCreate = async () => {
    if (!formAmount || parseFloat(formAmount) <= 0) { setFormError('请输入有效金额'); return }
    if (formType === 'TRANSFER') {
      if (!formFromAccountId) { setFormError('请选择转出账户'); return }
      if (!formToAccountId) { setFormError('请选择转入账户'); return }
      if (formFromAccountId === formToAccountId) { setFormError('转出和转入账户不能相同'); return }
    } else {
      if (!formAccountId) { setFormError('请选择账户'); return }
    }
    if (!currentBookId) return
    setSubmitting(true)
    try {
      await recordApi.create({
        accountBookId: currentBookId,
        type: formType,
        amount: parseFloat(formAmount),
        date: new Date(formDate).toISOString(),
        accountId: formType === 'TRANSFER' ? formFromAccountId : formAccountId,
        fromAccountId: formType === 'TRANSFER' ? formFromAccountId : undefined,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formCategoryCode || undefined,
        payer: formPayer || undefined,
        remark: formRemark || undefined,
        tags: formTags.length > 0 ? formTags : undefined,
        ownerId: formOwnerId === '__self__' ? undefined : (formOwnerId || undefined),
        attachmentIds: formAttachments.map((a) => a.id),
      })
      onClose()
      onSaved(false)
    } catch (e: any) { setFormError(e.message) }
    finally { setSubmitting(false) }
  }

  const handleUpdate = async () => {
    if (!editRecord) return
    if (!formAmount || parseFloat(formAmount) <= 0) { setFormError('请输入有效金额'); return }
    setSubmitting(true)
    try {
      await recordApi.update(editRecord.id, {
        type: formType,
        amount: parseFloat(formAmount),
        date: new Date(formDate).toISOString(),
        accountId: formType === 'TRANSFER' ? formFromAccountId : formAccountId,
        fromAccountId: formType === 'TRANSFER' ? formFromAccountId : undefined,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formCategoryCode || undefined,
        payer: formPayer || undefined,
        remark: formRemark || undefined,
        tags: formTags.length > 0 ? formTags : undefined,
        ownerId: formOwnerId === '__self__' ? undefined : (formOwnerId || undefined),
        attachmentIds: formAttachments.map((a) => a.id),
      })
      onClose()
      onSaved(true)
    } catch (e: any) { setFormError(e.message) }
    finally { setSubmitting(false) }
  }

  const handleDownload = async (url: string, originalFilename: string) => {
    try {
      const relativePath = url.includes('/api/uploads/')
        ? `/api/uploads/${url.split('/api/uploads/').pop()}`
        : url
      const downloadUrl = `/api/records/download?path=${encodeURIComponent(relativePath)}&name=${encodeURIComponent(originalFilename)}`

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
      a.download = originalFilename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (err: any) {
      setFormError(err.message || '下载失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogTrigger />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editRecord ? '编辑流水' : '记一笔'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
          {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}

          <div className="flex gap-3">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">类型</Label>
              <Tabs value={formType} onValueChange={(v) => setFormType(v as RecordType)}>
                <TabsList className="h-9 w-full grid grid-cols-3 p-0.5 gap-0.5 bg-muted rounded-lg">
                  {(['EXPENSE', 'INCOME', 'TRANSFER'] as RecordType[]).map((t) => (
                    <TabsTrigger
                      key={t}
                      value={t}
                      className={`text-xs rounded-md h-8 data-[state=active]:bg-background data-[state=active]:shadow-sm ${RECORD_TYPE_TEXT_CLASS[t]}`}
                    >
                      {RECORD_TYPE_LABELS[t]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">金额</Label>
              <Input
                aria-label="金额"
                type="number"
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => { setFormAmount(e.target.value); setFormError('') }}
                className="bg-background border-border"
                autoFocus
              />
            </div>
          </div>

          <div className="flex gap-3">
            {formType === 'TRANSFER' ? (
              <>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">转出账户</Label>
                  <Select value={formFromAccountId} onValueChange={setFormFromAccountId}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue placeholder="选择转出账户" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{accountLabel(a, multiOwnerAccounts)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">转入账户</Label>
                  <Select value={formToAccountId} onValueChange={setFormToAccountId}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue placeholder="选择转入账户" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{accountLabel(a, multiOwnerAccounts)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">账户</Label>
                <Select value={formAccountId} onValueChange={(v) => { setFormAccountId(v); setFormError('') }}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="选择账户" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{accountLabel(a, multiOwnerAccounts)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">日期</Label>
              <DateTimePicker
                value={formDate}
                onChange={setFormDate}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">分类</Label>
            <DictCombobox
              group={getCategoryGroup(formType)}
              value={formCategoryCode}
              onChange={setFormCategoryCode}
              placeholder="选择分类（可选）"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">交易方</Label>
            <Input
              aria-label="交易方"
              placeholder="商家、对方账户名等（可选）"
              value={formPayer}
              onChange={(e) => setFormPayer(e.target.value)}
              className="bg-background border-border"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">标签</Label>
            <TagCombobox
              value={formTags}
              onChange={setFormTags}
              bookId={currentBookId || ''}
              placeholder="选择或输入标签..."
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">归属人</Label>
            <Select value={formOwnerId} onValueChange={setFormOwnerId}>
              <SelectTrigger className="h-9 text-sm w-full">
                <SelectValue placeholder="本人（默认）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__self__" className="text-sm">本人（默认）</SelectItem>
                {bookMembers.map(m => (
                  <SelectItem key={m.userId} value={m.userId} className="text-sm">
                    {m.user.nickname || m.user.email || m.userId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">备注</Label>
            <Textarea
              placeholder="备注信息（可选）"
              value={formRemark}
              onChange={(e) => setFormRemark(e.target.value)}
              className="bg-background border-border min-h-[80px]"
              rows={3}
            />
          </div>

          {/* 附件上传 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">附件</Label>
            <div className="flex flex-col gap-2">
              {formAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formAttachments.map((att, idx) => {
                    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(att.url)
                    return (
                      <div key={idx} className="relative group">
                        {isImage ? (
                          <button
                            className="w-16 h-16 rounded-md border overflow-hidden"
                            onClick={() => setPreviewImage(att.fullUrl)}
                          >
                            <img
                              src={att.fullUrl}
                              alt="附件"
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="w-16 h-16 rounded-md border bg-muted flex items-center justify-center">
                            <span className="text-xs text-muted-foreground truncate px-1">{att.originalFilename}</span>
                          </div>
                        )}
                        <button
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#ef4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setFormAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <X size={10} />
                        </button>
                        <button
                          className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#3b82f6] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.originalFilename) }}
                        >
                          <Download size={10} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-md cursor-pointer hover:bg-accent text-sm text-muted-foreground">
                <Upload size={14} />
                <span>{uploadingAttachment ? '上传中...' : '添加附件'}</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={uploadingAttachment}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || [])
                    if (!files.length) return
                    setUploadingAttachment(true)
                    try {
                      const results = await Promise.all(files.map((f) => recordApi.uploadAttachment(f)))
                      setFormAttachments((prev) => [...prev, ...results.map((r) => ({
                        id: r.id,
                        url: r.url,
                        fullUrl: r.fullUrl,
                        originalFilename: r.originalFilename,
                      }))])
                    } catch (err: any) {
                      setFormError(err.message || '上传失败')
                    } finally {
                      setUploadingAttachment(false)
                      e.target.value = ''
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={editRecord ? handleUpdate : handleCreate}
            disabled={submitting}
          >
            {submitting ? '保存中...' : editRecord ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 图片预览弹窗 */}
      {previewImage && (
        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogTrigger />
          <DialogContent className="max-w-3xl p-0 bg-transparent border-0">
            <div className="relative">
              <img
                src={previewImage}
                alt="预览"
                className="max-h-[80vh] max-w-full rounded-lg"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => {
                    const att = formAttachments.find((a) => a.fullUrl === previewImage)
                    handleDownload(previewImage, att?.originalFilename || '图片.png')
                  }}
                  className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => setPreviewImage(null)}
                  className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  )
}
