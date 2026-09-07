import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { DictCombobox } from '@/components/DictCombobox'
import { TagCombobox } from '@/components/TagCombobox'
import { recordApi } from '@/api/record'
import { RECORD_TYPE_LABELS } from '@/lib/record-type'
import type { AccountItem } from '@/api/account'
import type { BookMember } from '@/api/book'
import type { RecordItem, RecordType } from '@/api/record'

interface Props {
  open: boolean
  selectedIds: string[]
  /** 当前页记录(判断选中项是否全为转账,决定账户/转账字段展示) */
  records: RecordItem[]
  currentBookId: string
  accounts: AccountItem[]
  bookMembers: BookMember[]
  onClose: () => void
  /** 更新成功回调(页面刷新列表并清空选择) */
  onDone: () => void
}

function getCategoryGroup(type: RecordType) {
  if (type === 'INCOME') return 'transaction_category_income'
  if (type === 'EXPENSE') return 'transaction_category_expense'
  return 'transaction_category_transfer'
}

/** 批量更新流水弹窗(留空字段不更新)。从 RecordsPage 拆出。 */
export function BatchEditDialog({ open, selectedIds, records, currentBookId, accounts, bookMembers, onClose, onDone }: Props) {
  const [batchDate, setBatchDate] = useState('')
  const [batchType, setBatchType] = useState('')
  const [batchAccountId, setBatchAccountId] = useState('')
  const [batchFromAccountId, setBatchFromAccountId] = useState('')
  const [batchToAccountId, setBatchToAccountId] = useState('')
  const [batchCategory, setBatchCategory] = useState('')
  const [batchTags, setBatchTags] = useState<string[]>([])
  const [batchPayer, setBatchPayer] = useState('')
  const [batchOwnerId, setBatchOwnerId] = useState('')
  const [batchAmount, setBatchAmount] = useState('')
  const [batchRemark, setBatchRemark] = useState('')
  const [batchError, setBatchError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const resetBatchForm = () => {
    setBatchDate('')
    setBatchType('')
    setBatchAccountId('')
    setBatchFromAccountId('')
    setBatchToAccountId('')
    setBatchCategory('')
    setBatchTags([])
    setBatchPayer('')
    setBatchOwnerId('')
    setBatchAmount('')
    setBatchRemark('')
    setBatchError('')
  }

  // 每次打开重置表单(原关闭时 reset 的逻辑前移)
  useEffect(() => {
    if (open) resetBatchForm()
  }, [open])

  const handleBatchUpdate = async () => {
    if (selectedIds.length === 0) return

    const data: any = {}
    if (batchDate) data.date = new Date(batchDate).toISOString()
    if (batchType) data.type = batchType
    if (batchType === 'TRANSFER' || (!batchType && records.filter(r => selectedIds.includes(r.id)).every(r => r.type === 'TRANSFER'))) {
      if (batchFromAccountId) {
        data.accountId = batchFromAccountId
        data.fromAccountId = batchFromAccountId
      }
      if (batchToAccountId) data.toAccountId = batchToAccountId
    } else if (batchAccountId) {
      data.accountId = batchAccountId
    }
    if (batchCategory) data.categoryCode = batchCategory === '__clear__' ? null : batchCategory
    if (batchTags.length > 0) data.tags = batchTags
    if (batchPayer) data.payer = batchPayer === '__clear__' ? null : batchPayer
    if (batchOwnerId) data.ownerId = batchOwnerId === '__self__' ? null : batchOwnerId
    if (batchAmount) {
      const amt = parseFloat(batchAmount)
      if (isNaN(amt) || amt <= 0) { setBatchError('金额必须大于0'); return }
      data.amount = amt
    }
    if (batchRemark) data.remark = batchRemark === '__clear__' ? null : batchRemark

    if (Object.keys(data).length === 0) { setBatchError('请至少填写一个字段'); return }

    setSubmitting(true)
    setBatchError('')
    try {
      await recordApi.batchUpdate(selectedIds, data)
      onClose()
      onDone()
    } catch (e: any) { setBatchError(e.message) }
    finally { setSubmitting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogTrigger />
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量更新 {selectedIds.length} 条记录</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* 日期 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">日期</Label>
            <DatePicker value={batchDate} onChange={setBatchDate} placeholder="留空则不更新日期" />
          </div>

          {/* 类型 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">类型</Label>
            <Select value={batchType} onValueChange={(v) => { setBatchType(v); setBatchAccountId(''); setBatchFromAccountId(''); setBatchToAccountId(''); setBatchCategory('') }}>
              <SelectTrigger className="bg-background border-border h-9"><SelectValue placeholder="留空则不更新类型" /></SelectTrigger>
              <SelectContent>
                {(['INCOME', 'EXPENSE', 'TRANSFER'] as RecordType[]).map((t) => (
                  <SelectItem key={t} value={t}>{RECORD_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 账户 */}
          {batchType === 'TRANSFER' ? (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">转出账户</Label>
                <Select value={batchFromAccountId} onValueChange={setBatchFromAccountId} disabled={!batchType}>
                  <SelectTrigger className="bg-background border-border h-9"><SelectValue placeholder="留空则不更新" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-muted-foreground mt-5">→</span>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">转入账户</Label>
                <Select value={batchToAccountId} onValueChange={setBatchToAccountId} disabled={!batchType}>
                  <SelectTrigger className="bg-background border-border h-9"><SelectValue placeholder="留空则不更新" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">账户</Label>
              <Select value={batchAccountId} onValueChange={setBatchAccountId} disabled={!batchType}>
                <SelectTrigger className="bg-background border-border h-9"><SelectValue placeholder={batchType ? '留空则不更新账户' : '请先选择类型'} /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 分类 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">分类</Label>
            <DictCombobox
              group={getCategoryGroup((batchType || 'EXPENSE') as RecordType)}
              value={batchCategory}
              onChange={setBatchCategory}
              placeholder={batchType ? '留空则不更新分类' : '请先选择类型'}
              disabled={!batchType}
            />
          </div>

          {/* 标签 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">标签</Label>
            <TagCombobox
              value={batchTags}
              onChange={setBatchTags}
              bookId={currentBookId || ''}
              placeholder="留空则不更新标签"
            />
          </div>

          {/* 归属人 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">归属人</Label>
            <Select value={batchOwnerId} onValueChange={setBatchOwnerId}>
              <SelectTrigger className="h-9 text-sm w-full">
                <SelectValue placeholder="留空则不更新归属人" />
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

          {/* 交易方 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">交易方</Label>
            <Input
              aria-label="交易方"
              placeholder="留空则不更新交易方"
              value={batchPayer}
              onChange={(e) => setBatchPayer(e.target.value)}
              className="bg-background border-border h-9"
            />
          </div>

          {/* 金额 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">金额</Label>
            <Input
              aria-label="金额"
              type="number"
              placeholder="留空则不更新金额"
              value={batchAmount}
              onChange={(e) => setBatchAmount(e.target.value)}
              className="bg-background border-border h-9"
              min="0"
              step="0.01"
            />
          </div>

          {/* 备注 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">备注</Label>
            <Textarea
              aria-label="备注"
              placeholder="留空则不更新备注"
              value={batchRemark}
              onChange={(e) => setBatchRemark(e.target.value)}
              className="bg-background border-border min-h-[60px]"
              rows={2}
            />
          </div>

          {batchError && <p className="text-sm text-[#ef4444]">{batchError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleBatchUpdate} disabled={submitting}>
            {submitting ? '更新中...' : '确认更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
