import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CheckCircle2 } from 'lucide-react'

// ---- 类型 ----

interface ConfirmRecord {
  rowIndex: number
  date: string
  type: string
  amount: number
  accountName: string
  accountId?: string | null
  toAccountName?: string | null
  toAccountId?: string | null
  categoryCode?: string | null
  categoryLabel?: string | null
  mappedCategoryCode?: string | null
  mappedCategoryLabel?: string | null
  payer?: string | null
  remark?: string
  tags?: string[]
}

interface AccountToCreate {
  name: string
  type: string
  typeLabel: string
}

interface Owner {
  id: string
  name: string
  isOwner: boolean
}

interface ConfirmPreviewData {
  mode: 'confirm_preview'
  source: string
  fileId: string
  accountsToCreate: AccountToCreate[]
  records: ConfirmRecord[]
  stats: {
    totalRecords: number
    incomeCount: number
    expenseCount: number
    transferCount: number
    accountsToCreate: number
  }
  ownerId: string
  owners: Owner[]
  accountBookId: string
}

interface ConfirmResultData {
  imported: number
  accountsCreated: number
}

type ConfirmCardData = ConfirmPreviewData | ConfirmResultData

function isPreviewData(data: ConfirmCardData): data is ConfirmPreviewData {
  return (data as any).mode === 'confirm_preview'
}

interface Props {
  data: ConfirmCardData
  toolCallId: string
}

export function ImportConfirmCard({ data, toolCallId }: Props) {
  const [ownerId, setOwnerId] = useState(isPreviewData(data) ? data.ownerId : '')

  // 如果已经是导入结果，直接显示
  if (!isPreviewData(data)) {
    return (
      <div className="space-y-3 mt-2">
        <div className="rounded-lg p-3 text-xs bg-green-50 border border-green-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500" />
            <span>
              已导入 <strong>{data.imported}</strong> 条记录
              {data.accountsCreated ? <>，新建 <strong>{data.accountsCreated}</strong> 个账户</> : ''}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const handleConfirm = () => {
    useChatStore.getState().confirmAndContinue(data.accountBookId, toolCallId, true, { fileId: data.fileId, ownerId })
  }

  const handleReject = () => {
    useChatStore.getState().confirmAndContinue(data.accountBookId, toolCallId, false)
  }

  const TYPE_LABELS: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' }
  const TYPE_COLORS: Record<string, string> = { INCOME: 'text-green-600', EXPENSE: 'text-red-600', TRANSFER: 'text-blue-600' }
  const SOURCE_LABELS: Record<string, string> = { alipay: '支付宝', wechat: '微信', jd: '京东' }

  return (
    <div className="space-y-3 mt-2">
      {/* 统计摘要 */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">{SOURCE_LABELS[data.source] || data.source}</Badge>
        <Badge variant="outline">{data.stats.totalRecords} 条记录</Badge>
        <Badge variant="outline" className="text-green-600">收入 {data.stats.incomeCount}</Badge>
        <Badge variant="outline" className="text-red-600">支出 {data.stats.expenseCount}</Badge>
        {data.stats.transferCount > 0 && (
          <Badge variant="outline" className="text-blue-600">转账 {data.stats.transferCount}</Badge>
        )}
        {data.stats.accountsToCreate > 0 && (
          <Badge variant="outline" className="text-amber-600">新增 {data.stats.accountsToCreate} 个账户</Badge>
        )}
      </div>

      {/* 新增账户列表 */}
      {data.accountsToCreate.length > 0 && (
        <div className="rounded border text-xs">
          <div className="text-muted-foreground px-2 py-1 bg-muted/30 font-medium">将创建以下账户</div>
          {data.accountsToCreate.map((a) => (
            <div key={a.name} className="flex items-center gap-2 px-2 py-1 border-t">
              <span className="font-medium">{a.name}</span>
              <Badge variant="secondary" className="text-[10px]">{a.typeLabel}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* 归属人选择 */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground shrink-0">归属人:</span>
        <Select value={ownerId} onValueChange={setOwnerId}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.owners.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 记录表格（仅显示前50条） */}
      {data.records.length > 0 && (
        <div className="rounded border overflow-hidden max-h-64 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] px-1.5 py-1 w-10">#</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">日期</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">类型</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1 text-right">金额</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">账户</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">目标账户</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">分类</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">映射分类</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">交易方</TableHead>
                <TableHead className="text-[10px] px-1.5 py-1">说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.records.slice(0, 50).map((r) => (
                <TableRow key={r.rowIndex}>
                  <TableCell className="text-[10px] px-1.5 py-0.5 text-muted-foreground">{r.rowIndex}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5">{r.date}</TableCell>
                  <TableCell className={cn('text-[10px] px-1.5 py-0.5', TYPE_COLORS[r.type] || '')}>
                    {TYPE_LABELS[r.type] || r.type}
                  </TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5 text-right font-mono">
                    {r.amount.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5">{r.accountName}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5 text-muted-foreground">
                    {r.toAccountName || '-'}
                  </TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5">
                    {r.categoryLabel || r.categoryCode || '-'}
                  </TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5">
                    <span className={r.mappedCategoryLabel ? 'text-green-600' : ''}>
                      {r.mappedCategoryLabel || r.mappedCategoryCode || '-'}
                    </span>
                  </TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5 max-w-16 truncate">{r.payer || '-'}</TableCell>
                  <TableCell className="text-[10px] px-1.5 py-0.5 text-muted-foreground max-w-20 truncate">{r.remark || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button size="sm" variant="default" onClick={handleConfirm}>
          确认导入 {data.stats.totalRecords} 条记录
        </Button>
        <Button size="sm" variant="outline" onClick={handleReject}>
          取消
        </Button>
      </div>
    </div>
  )
}
