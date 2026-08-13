import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { DatePicker } from '@/components/ui/date-picker'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { TagCombobox } from '@/components/TagCombobox'
import { Paperclip, Pencil, Copy, Trash2 } from 'lucide-react'
import dayjs from 'dayjs'
import type { RecordItem, RecordType } from '@/api/record'
import type { AccountItem } from '@/api/account'
import type { DictItem } from '@/api/settings'
import type { BookMember } from '@/api/book'
import { cn } from '@/lib/utils'

const TYPE_COLORS: Record<RecordType, string> = {
  INCOME: 'text-[#22c55e] bg-[#22c55e]/10',
  EXPENSE: 'text-[#ef4444] bg-[#ef4444]/10',
  TRANSFER: 'text-[#3b82f6] bg-[#3b82f6]/10',
}
const TYPE_LABELS: Record<RecordType, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

function getCategoryGroup(type: RecordType) {
  if (type === 'INCOME') return 'transaction_category_income'
  if (type === 'EXPENSE') return 'transaction_category_expense'
  return 'transaction_category_transfer'
}

interface RecordRowProps {
  record: RecordItem
  variant: 'table' | 'card'
  editMode: boolean
  editChanges: Map<string, Record<string, string>>
  selectedIds: Set<string>
  accounts: AccountItem[]
  allCategories: DictItem[]
  bookMembers: BookMember[]
  currentBookId: string
  onToggleSelect: (id: string) => void
  onEditChange: (id: string, field: string, value: string) => void
  onOpenEdit: (r: RecordItem) => void
  onClone: (r: RecordItem) => void
  onDelete: (r: RecordItem) => void
  onViewAttachments: (att: { id: string; url: string; originalFilename: string }[]) => void
}

export function RecordRow(props: RecordRowProps) {
  const {
    record, variant, editMode, editChanges, selectedIds, accounts,
    allCategories, bookMembers, currentBookId,
    onToggleSelect, onEditChange, onOpenEdit, onClone, onDelete, onViewAttachments,
  } = props

  const isChanged = editChanges.has(record.id)
  const effectiveType = (editChanges.get(record.id)?.type || record.type) as RecordType
  const catGroup = getCategoryGroup(effectiveType)
  const rowCategories = allCategories.filter((c) => c.group === catGroup)

  const getEditValue = (field: string): string => {
    const changes = editChanges.get(record.id)
    if (changes && field in changes) return changes[field]
    switch (field) {
      case 'date': return dayjs(record.date).format('YYYY-MM-DD')
      case 'amount': return String(record.amount)
      case 'categoryCode': return record.categoryCode || ''
      case 'payer': return record.payer || ''
      case 'remark': return record.remark || ''
      case 'type': return record.type
      case 'accountId': return record.accountId
      case 'fromAccountId': return record.fromAccountId || ''
      case 'toAccountId': return record.toAccountId || ''
      default: return ''
    }
  }

  const getEditTags = (): string[] => {
    const changes = editChanges.get(record.id)
    if (changes && 'tags' in changes) {
      try { return JSON.parse(changes.tags) } catch { return [] }
    }
    return record.tags || []
  }

  const change = (field: string, value: string) => onEditChange(record.id, field, value)

  // ---- 编辑器渲染（table / card 共用） ----
  const renderDate = () =>
    editMode ? (
      <DatePicker value={getEditValue('date')} onChange={(v) => v && change('date', v)} className="h-8 px-2 flex-1 min-w-0" compact />
    ) : (
      <span className="text-xs">{new Date(record.date).toLocaleDateString('zh-CN')}</span>
    )

  const renderType = () =>
    editMode ? (
      <Select value={getEditValue('type')} onValueChange={(v) => change('type', v)}>
        <SelectTrigger className="h-7 text-xs w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(['INCOME', 'EXPENSE', 'TRANSFER'] as RecordType[]).map((t) => (
            <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <Badge className={`text-[10px] ${TYPE_COLORS[record.type]}`}>{TYPE_LABELS[record.type]}</Badge>
    )

  const renderAccount = () =>
    editMode ? (
      effectiveType === 'TRANSFER' ? (
        <div className="flex items-center gap-1">
          <Select value={getEditValue('fromAccountId')} onValueChange={(v) => change('fromAccountId', v)}>
            <SelectTrigger className="h-7 text-xs flex-1 min-w-0"><SelectValue placeholder="转出" /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground shrink-0">→</span>
          <Select value={getEditValue('toAccountId')} onValueChange={(v) => change('toAccountId', v)}>
            <SelectTrigger className="h-7 text-xs flex-1 min-w-0"><SelectValue placeholder="转入" /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : (
        <Select value={getEditValue('accountId')} onValueChange={(v) => change('accountId', v)}>
          <SelectTrigger className="h-7 text-xs w-full"><SelectValue placeholder="账户" /></SelectTrigger>
          <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
      )
    ) : (
      record.type === 'TRANSFER' && record.fromAccount ? (
        <span>
          <span className="text-[#ef4444]">{record.fromAccount.name}</span>
          {' → '}
          <span className="text-[#22c55e]">{record.toAccount?.name}</span>
        </span>
      ) : (
        <span>{record.account.name}</span>
      )
    )

  const renderCategory = () =>
    editMode ? (
      <Select value={getEditValue('categoryCode')} onValueChange={(v) => change('categoryCode', v === '__clear__' ? '' : v)}>
        <SelectTrigger className="h-7 text-xs w-full"><SelectValue placeholder="分类" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__clear__">无</SelectItem>
          {rowCategories.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
    ) : (
      <span className="text-muted-foreground">{record.categoryCode || '-'}</span>
    )

  const renderTags = () =>
    editMode ? (
      <TagCombobox
        value={getEditTags()}
        onChange={(tags) => change('tags', JSON.stringify(tags))}
        bookId={currentBookId}
        placeholder="标签..."
        compact
      />
    ) : (
      record.tags?.length > 0 ? (
        <div className="flex flex-wrap gap-0.5">
          {record.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] py-0 px-1">{tag}</Badge>
          ))}
        </div>
      ) : <span className="text-muted-foreground">-</span>
    )

  const renderOwner = () =>
    editMode ? (
      <Select value={getEditValue('ownerId')} onValueChange={(v) => change('ownerId', v)}>
        <SelectTrigger className="h-7 text-xs w-full"><SelectValue placeholder="本人" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__self__">本人（默认）</SelectItem>
          {bookMembers.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>{m.user.nickname || m.user.email || m.userId}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <span className="text-muted-foreground">{record.ownerName || '-'}</span>
    )

  const renderPayer = () =>
    editMode ? (
      <Input aria-label="交易方" value={getEditValue('payer')} onChange={(e) => change('payer', e.target.value)} className="h-7 text-xs w-full" placeholder="-" />
    ) : (
      <span className="text-muted-foreground">{record.payer || '-'}</span>
    )

  const renderAmount = () => {
    const color = record.type === 'INCOME' ? 'text-[#22c55e]' : record.type === 'EXPENSE' ? 'text-[#ef4444]' : 'text-[#3b82f6]'
    return editMode ? (
      <Input aria-label="金额" type="number" step="0.01" value={getEditValue('amount')}
        onChange={(e) => change('amount', e.target.value)}
        className={`h-7 text-xs w-full text-right ${color}`} />
    ) : (
      <span className={cn('font-bold tabular-nums', color)}>
        {record.type === 'EXPENSE' ? '-' : record.type === 'INCOME' ? '+' : ''}{formatMoney(record.amount)}
      </span>
    )
  }

  const renderRemark = () =>
    editMode ? (
      <Input aria-label="备注" value={getEditValue('remark')} onChange={(e) => change('remark', e.target.value)} className="h-7 text-xs w-full" placeholder="-" />
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground max-w-32 truncate cursor-default block">{record.remark || '-'}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="break-all">{record.remark || '无备注'}</p>
        </TooltipContent>
      </Tooltip>
    )

  const renderActions = () => (
    <div className="flex items-center justify-end gap-0.5">
      {record.attachments?.length > 0 && (
        <Button aria-label="设置附件查看器" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewAttachments(record.attachments)}>
          <Paperclip size={13} />
        </Button>
      )}
      {editMode ? (
        <>
          <Button aria-label="复制" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClone(record)}><Copy size={13} /></Button>
          <Button aria-label="删除" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]" onClick={() => onDelete(record)}><Trash2 size={13} /></Button>
        </>
      ) : (
        <>
          <Button aria-label="编辑" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenEdit(record)}><Pencil size={13} /></Button>
          <Button aria-label="复制" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClone(record)}><Copy size={13} /></Button>
          <Button aria-label="删除" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]" onClick={() => onDelete(record)}><Trash2 size={13} /></Button>
        </>
      )}
    </div>
  )

  // ---- 卡片模式（移动端） ----
  if (variant === 'card') {
    const checkbox = !editMode && (
      <input
        type="checkbox"
        checked={selectedIds.has(record.id)}
        onChange={() => onToggleSelect(record.id)}
        className="rounded shrink-0"
      />
    )

    return (
      <div className={cn(
        'p-3 rounded-xl border transition-colors',
        isChanged ? 'border-primary/50 shadow-[inset_3px_0_0_hsl(var(--primary))]' : 'border-border hover:bg-accent/60',
        editMode && 'bg-accent/30',
      )}>
        {/* 编辑态：字段纵向堆叠 */}
        {editMode ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">编辑流水</span>
              {isChanged && <span className="w-2 h-2 rounded-full bg-primary shrink-0" title="已修改" />}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <Label className="text-xs text-muted-foreground mb-1 block">日期</Label>
                {renderDate()}
              </div>
              <div className="w-24">
                <Label className="text-xs text-muted-foreground mb-1 block">类型</Label>
                {renderType()}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">账户</Label>
              {renderAccount()}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">分类</Label>
              {renderCategory()}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">标签</Label>
              {renderTags()}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">归属人</Label>
              {renderOwner()}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">交易方</Label>
              {renderPayer()}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">金额</Label>
              {renderAmount()}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">备注</Label>
              {renderRemark()}
            </div>
            <div className="pt-1 border-t border-border">
              {renderActions()}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* 第一行：复选框 + 日期 + 类型 + 金额 */}
            <div className="flex items-center gap-2">
              {checkbox}
              <span className="text-xs text-muted-foreground">{new Date(record.date).toLocaleDateString('zh-CN')}</span>
              <Badge className={`text-[10px] ${TYPE_COLORS[record.type]}`}>{TYPE_LABELS[record.type]}</Badge>
              <span className="ml-auto text-sm font-bold tabular-nums">{renderAmount()}</span>
            </div>
            {/* 第二行：账户 | 分类 */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{renderAccount()}</span>
              <span>|</span>
              <span className="truncate">{record.categoryCode || '未分类'}</span>
              {record.tags?.length > 0 && (
                <>
                  <span>|</span>
                  <span className="truncate">{record.tags.join('、')}</span>
                </>
              )}
            </div>
            {/* 第三行：归属人 | 交易方 | 备注 */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
              <span className="truncate">{record.ownerName || '本人'}</span>
              {record.payer && (<><span>|</span><span className="truncate">{record.payer}</span></>)}
              {record.remark && (<><span>|</span><span className="truncate">{record.remark}</span></>)}
            </div>
            {/* 操作行 */}
            <div className="flex items-center justify-end -mr-1 -mt-0.5">
              {renderActions()}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- 表格模式（桌面端） ----
  return (
    <TableRow key={record.id} className={isChanged ? 'shadow-[inset_3px_0_0_hsl(var(--primary))] hover:bg-accent/50' : 'hover:bg-accent/50'}>
      {!editMode && (
        <TableCell className="py-2.5">
          <input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => onToggleSelect(record.id)} className="rounded" />
        </TableCell>
      )}
      <TableCell className="py-2.5">
        <div className="flex items-center gap-1.5">
          {editMode && isChanged && <span className="w-2 h-2 rounded-full bg-primary shrink-0" title="已修改" />}
          {renderDate()}
        </div>
      </TableCell>
      <TableCell className="py-2.5">{renderType()}</TableCell>
      <TableCell className="text-xs py-2.5">{renderAccount()}</TableCell>
      <TableCell className="text-xs py-2.5">{renderCategory()}</TableCell>
      <TableCell className="text-xs py-2.5">{renderTags()}</TableCell>
      <TableCell className="text-xs py-2.5">{renderOwner()}</TableCell>
      <TableCell className="text-xs py-2.5">{renderPayer()}</TableCell>
      <TableCell className="text-sm font-bold tabular-nums py-2.5 text-right">{renderAmount()}</TableCell>
      <TableCell className="text-xs py-2.5">{renderRemark()}</TableCell>
      <TableCell className="text-right py-2.5">{renderActions()}</TableCell>
    </TableRow>
  )
}