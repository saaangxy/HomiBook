import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { markSubmitted, isSubmitted, clearSubmitted } from '@/lib/ai-submit'
import { ACCOUNT_TYPE_LABELS, type AccountType } from '@/api/account'
import { useChatStore } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, ChevronDown, Loader2, Search } from 'lucide-react'

// ---- 类型 ----

interface ParsedRow {
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

interface UnmatchedAccount {
  csvName: string
  suggestedType: string
  suggestedName: string
  bankName?: string
  accountNo?: string
  candidates?: { id: string; name: string }[]
  aiResolution?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }
}

interface UnmatchedCategory {
  sourceCategory: string
  suggestedCode: string | null
  types: string[]
  aiTargetCode?: string
  aiRecordType?: string
  payerContains?: string
  descriptionContains?: string
}

interface DictEntry {
  code: string
  label: string
  group: string
}

export interface ImportPreviewData {
  source?: string
  mode?: string
  confirmed?: boolean
  records?: ParsedRow[]
  unrecognizedRecords?: ParsedRow[]
  unmatchedAccounts?: UnmatchedAccount[]
  unmatchedCategories?: UnmatchedCategory[]
  allDictItems?: DictEntry[]
  accountMappingNames?: Record<string, string>
  accounts?: { id: string; name: string; type: string }[]
  accountBookId?: string
  mappedCategories?: { sourceCategory: string; sourceLabel: string; targetCode: string; targetLabel: string }[]
  stats?: { totalLines: number; parsedRows: number; skippedRows: number; unrecognizedCount: number; errors: string[] }
}

// ---- 常量 ----

const TYPE_LABELS: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账', UNKNOWN: '未知' }
const TYPE_COLORS: Record<string, string> = { INCOME: 'text-[#22c55e]', EXPENSE: 'text-[#ef4444]', TRANSFER: 'text-[#3b82f6]' }
const TYPE_TO_GROUP: Record<string, string> = {
  EXPENSE: 'transaction_category_expense',
  INCOME: 'transaction_category_income',
  TRANSFER: 'transaction_category_transfer',
}
const GROUP_HEADING: Record<string, string> = {
  transaction_category_expense: '支出分类',
  transaction_category_income: '收入分类',
  transaction_category_transfer: '转账分类',
}

interface AIAccountResolution {
  sourceAccountName: string
  action: 'existing' | 'create'
  targetAccountId?: string
  targetAccountName?: string
  accountType?: string
}

interface AICategoryResolution {
  sourceCategory: string
  targetCategoryCode: string
  recordType?: string
  payerContains?: string
  descriptionContains?: string
}

interface Props {
  data: ImportPreviewData
  source: string
  accountBookId: string
  toolCallId?: string
  aiArgs?: {
    fileId?: string
    accountResolutions?: AIAccountResolution[]
    categoryResolutions?: AICategoryResolution[]
  }
}

export function ImportPreviewInteractive({ data, accountBookId, toolCallId, aiArgs }: Props) {
  const stats = data.stats
  const records = data.records || []
  const unrecognizedRecords = data.unrecognizedRecords || []
  const accounts = data.accounts || []
  const allDictItems = data.allDictItems || []
  const isConfirmed = !!data.confirmed
  const submitted = isSubmitted(toolCallId)

  // ---- 状态 ----
  const [tab, setTab] = useState<'records' | 'unmatchedAccounts' | 'unmatchedCategories' | 'unrecognized'>('records')

  // 账户解析
  type AccountResolution =
    | { action: 'create'; name: string; type: string }
    | { action: 'existing'; accountId: string }
  const [accountResolutions, setAccountResolutions] = useState<Record<string, AccountResolution>>({})

  // 分类解析 - 数组结构，复制/删除/更新全部操作此字段
  interface CategoryResolution { id: string; sourceCategory: string; type: string; targetCode: string; save: boolean; payerContains: string; descriptionContains: string }
  const [categoryResolutions, setCategoryResolutions] = useState<CategoryResolution[]>([])

  // 未识别记录解析
  type UnrecognizedResolution = { type: string; accountId: string; categoryCode: string }
  const [unrecognizedResolutions, setUnrecognizedResolutions] = useState<Record<number, UnrecognizedResolution>>({})

  // 分类弹出框
  const [comboOpen, setComboOpen] = useState<string | null>(null)
  const [categorySearch, setCategorySearch] = useState('')

  const [confirmError, setConfirmError] = useState<string | null>(null)

  // 后端在 /confirm 返回后设置 confirmed:true，前端据此清除提交标记（按钮已切换为「已确认」）
  useEffect(() => {
    if (data?.confirmed) clearSubmitted(toolCallId)
  }, [data?.confirmed, toolCallId])

  // ---- 初始化 ----
  const initialized = { current: false }
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    // 账户解析
    const acctRes: Record<string, AccountResolution> = {}
    for (const ua of data.unmatchedAccounts || []) {
      if (ua.aiResolution) {
        const ar = ua.aiResolution
        if (ar.action === 'existing' && ar.targetAccountId) {
          acctRes[ua.csvName] = { action: 'existing', accountId: ar.targetAccountId }
        } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
          acctRes[ua.csvName] = { action: 'create', name: ar.targetAccountName, type: ar.accountType }
        }
      } else if (ua.candidates?.length) {
        acctRes[ua.csvName] = { action: 'existing', accountId: ua.candidates[0].id }
      } else {
        acctRes[ua.csvName] = { action: 'create', name: ua.suggestedName, type: ua.suggestedType }
      }
    }
    // AI 提供的账户映射回显（覆盖默认值）
    if (aiArgs?.accountResolutions) {
      for (const ar of aiArgs.accountResolutions) {
        if (ar.action === 'existing' && ar.targetAccountId) {
          acctRes[ar.sourceAccountName] = { action: 'existing', accountId: ar.targetAccountId }
        } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
          acctRes[ar.sourceAccountName] = { action: 'create', name: ar.targetAccountName, type: ar.accountType }
        }
      }
    }
    setAccountResolutions(acctRes)

    // 分类解析 - 直接从后端映射规则构建数组
    setCategoryResolutions(
      (data.unmatchedCategories || [])
        .filter(uc => uc.aiRecordType || uc.types[0])
        .map((uc, i) => ({
          id: String(i),
          sourceCategory: uc.sourceCategory,
          type: uc.aiRecordType || uc.types[0] || '',
          targetCode: uc.suggestedCode || '',
          save: true,
          payerContains: uc.payerContains || '',
          descriptionContains: uc.descriptionContains || '',
        }))
    )

    // 未识别记录
    const unresRes: Record<number, UnrecognizedResolution> = {}
    for (const r of data.unrecognizedRecords || []) {
      unresRes[r.rowIndex] = { type: '', accountId: r.accountId || accounts[0]?.id || '', categoryCode: r.mappedCategoryCode || r.categoryCode || '' }
    }
    setUnrecognizedResolutions(unresRes)
  }, [])

  // ---- 计算 ----
  const unresolvedAcctCount = (data.unmatchedAccounts || []).filter(ua => {
    const res = accountResolutions[ua.csvName]
    return res && (res.action === 'existing' ? !res.accountId : !res.name)
  }).length
  const unresolvedCatCount = categoryResolutions.filter(cr => !cr.targetCode).length
  const unresolvedUnrecCount = unrecognizedRecords.filter(r => {
    const res = unrecognizedResolutions[r.rowIndex]
    return !res?.type || !res?.accountId
  }).length

  const allRecords = [...records, ...unrecognizedRecords]

  const tabs = [
    { key: 'records' as const, label: `记录 (${allRecords.length})` },
    { key: 'unmatchedAccounts' as const, label: `未匹配账户 (${(data.unmatchedAccounts || []).length})` },
    { key: 'unmatchedCategories' as const, label: `未匹配分类 (${categoryResolutions.length})` },
    { key: 'unrecognized' as const, label: `需处理 (${unrecognizedRecords.length})` },
  ]

  // ---- 分类弹出框过滤 ----
  const getFilteredDictItems = (type: string) => {
    const group = TYPE_TO_GROUP[type]
    const items = group ? allDictItems.filter(d => d.group === group) : allDictItems
    if (!categorySearch) return items
    const s = categorySearch.toLowerCase()
    return items.filter(d => d.label.toLowerCase().includes(s) || d.code.toLowerCase().includes(s))
  }

  const groupedDictItems = (type: string) => {
    const items = getFilteredDictItems(type)
    const groups = new Map<string, DictEntry[]>()
    for (const d of items) {
      const list = groups.get(d.group) || []
      list.push(d)
      groups.set(d.group, list)
    }
    return groups
  }

  // ---- 渲染 ----
  return (
    <div className="space-y-2">
      {/* 统计摘要 */}
      {stats && (
        <div className="grid grid-cols-4 gap-1 text-[10px]">
          <div className="bg-background rounded px-1.5 py-0.5 text-center">
            <span className="text-muted-foreground">总行数 </span>
            <span className="font-medium">{stats.totalLines}</span>
          </div>
          <div className="bg-background rounded px-1.5 py-0.5 text-center">
            <span className="text-muted-foreground">已解析 </span>
            <span className="font-medium text-[#22c55e]">{stats.parsedRows}</span>
          </div>
          <div className="bg-background rounded px-1.5 py-0.5 text-center">
            <span className="text-muted-foreground">跳过 </span>
            <span className="font-medium text-amber-600">{stats.skippedRows}</span>
          </div>
          <div className="bg-background rounded px-1.5 py-0.5 text-center">
            <span className="text-muted-foreground">待处理 </span>
            <span className="font-medium text-[#ef4444]">{unresolvedAcctCount + unresolvedCatCount + unresolvedUnrecCount}</span>
          </div>
        </div>
      )}

      {/* 错误详情 */}
      {stats?.errors && stats.errors.length > 0 && (
        <details className="text-[10px]">
          <summary className="text-muted-foreground cursor-pointer">跳过/错误详情 ({stats.errors.length})</summary>
          <ul className="list-disc pl-4 text-muted-foreground mt-0.5">
            {stats.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </details>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button
            key={t.key}
            className={cn(
              'text-[10px] px-2 py-0.5 border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-primary font-medium' : 'border-transparent text-muted-foreground',
            )}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 记录列表 */}
      {tab === 'records' && (
        <>
          <div className="rounded border overflow-hidden max-h-64 overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                <th className="px-1 py-0.5 text-left">#</th>
                <th className="px-1 py-0.5 text-left">日期</th>
                <th className="px-1 py-0.5 text-left">类型</th>
                <th className="px-1 py-0.5 text-right">金额</th>
                <th className="px-1 py-0.5 text-left">账户</th>
                <th className="px-1 py-0.5 text-left">分类</th>
                <th className="px-1 py-0.5 text-left">映射分类</th>
                <th className="px-1 py-0.5 text-left">交易方</th>
                <th className="px-1 py-0.5 text-left">说明</th>
              </tr>
            </thead>
            <tbody>
              {allRecords.map((r, i) => {
                const displayDate = (() => {
                  try {
                    const d = new Date(r.date)
                    if (isNaN(d.getTime())) return r.date
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                  } catch { return r.date }
                })()
                return (
                <tr key={i} className={cn('border-t', r.type === 'UNKNOWN' && 'bg-red-50/30')}>
                  <td className="px-1 py-0.5 text-muted-foreground">{r.rowIndex}</td>
                  <td className="px-1 py-0.5">{displayDate}</td>
                  <td className={cn('px-1 py-0.5', TYPE_COLORS[r.type])}>{TYPE_LABELS[r.type] || r.type}</td>
                  <td className="px-1 py-0.5 text-right">{r.amount.toFixed(2)}</td>
                  <td className="px-1 py-0.5">{r.accountName}</td>
                  <td className="px-1 py-0.5">{r.categoryLabel || r.categoryCode || '-'}</td>
                  <td className="px-1 py-0.5">{r.mappedCategoryLabel || r.mappedCategoryCode || '-'}</td>
                  <td className="px-1 py-0.5 max-w-16 truncate">{r.payer || '-'}</td>
                  <td className="px-1 py-0.5 text-muted-foreground max-w-20 truncate">{r.remark || '-'}</td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* 未匹配账户 */}
      {tab === 'unmatchedAccounts' && (
        <div className="space-y-2">
          {(data.unmatchedAccounts || []).length === 0 ? (
            <p className="text-muted-foreground text-xs">全部账户已匹配</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                同一银行账户可能有多个名称变体，设为相同名称即可合并
              </p>
              <div className="space-y-1.5">
                {(data.unmatchedAccounts || []).map(ua => {
                  const res = accountResolutions[ua.csvName]
                  return (
                    <div key={ua.csvName} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <span className="text-xs font-medium min-w-[80px] max-w-[100px] truncate">{ua.csvName}</span>
                      {res?.action === 'create' ? (
                        <>
                          <Input
                            className="h-7 text-xs bg-background flex-1"
                            value={res.name}
                            onChange={(e) => setAccountResolutions(prev => ({ ...prev, [ua.csvName]: { ...res, name: e.target.value } }))}
                          />
                          <Select
                            value={res.type}
                            onValueChange={(v) => setAccountResolutions(prev => ({ ...prev, [ua.csvName]: { ...res, type: v } }))}
                          >
                            <SelectTrigger className="h-7 text-xs w-24 bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([k, v]) => (
                                <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Badge variant="secondary" className="text-[10px] shrink-0">新建</Badge>
                        </>
                      ) : (
                        <>
                          <Select
                            value={res?.action === 'existing' ? res.accountId : ''}
                            onValueChange={(v) => setAccountResolutions(prev => ({ ...prev, [ua.csvName]: { action: 'existing', accountId: v } }))}
                          >
                            <SelectTrigger className="h-7 text-xs flex-1 bg-background">
                              <SelectValue placeholder="选择已有账户..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(ua.candidates || accounts).map(a => (
                                <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Badge variant="secondary" className="text-[10px] shrink-0">已有</Badge>
                        </>
                      )}
                      <Button
                        variant="ghost" size="sm" className="text-[10px] text-muted-foreground h-7 shrink-0"
                        onClick={() => {
                          if (res?.action === 'create') {
                            setAccountResolutions(prev => ({ ...prev, [ua.csvName]: { action: 'existing', accountId: accounts[0]?.id || '' } }))
                          } else {
                            setAccountResolutions(prev => ({ ...prev, [ua.csvName]: { action: 'create', name: ua.suggestedName, type: ua.suggestedType } }))
                          }
                        }}
                      >
                        切换
                      </Button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* 未匹配分类 */}
      {tab === 'unmatchedCategories' && (
        <div className="space-y-2">
          {categoryResolutions.length === 0 ? (
            <p className="text-muted-foreground text-xs">全部分类已映射</p>
          ) : (
            (() => {
              const grouped = Map.groupBy(categoryResolutions, cr => cr.type)
              return (
                <div className="space-y-2">
                  {[...grouped.entries()].map(([type, items]) => (
                    <div key={type}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={cn('text-[10px]', type === 'EXPENSE' ? 'bg-[#fef2f2] text-[#ef4444]' : type === 'INCOME' ? 'bg-[#f0fdf4] text-[#22c55e]' : 'bg-[#eff6ff] text-[#3b82f6]')}>
                          {TYPE_LABELS[type]}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{items.length} 项</span>
                      </div>
                      <div className="space-y-1">
                        {items.map(cr => {
                          const updateCr = (patch: Partial<CategoryResolution>) =>
                            setCategoryResolutions(prev => prev.map(e => e.id === cr.id ? { ...e, ...patch } : e))

                          return (
                            <div key={cr.id} className="flex items-center gap-1.5 p-1.5 rounded bg-muted/30">
                              <span className="text-[10px] font-medium min-w-[50px] max-w-[70px] truncate">{cr.sourceCategory}</span>
                              <Input
                                className="h-6 text-[10px] w-[80px]"
                                placeholder="交易方正则"
                                value={cr.payerContains}
                                onChange={(e) => updateCr({ payerContains: e.target.value })}
                              />
                              <Input
                                className="h-6 text-[10px] w-[80px]"
                                placeholder="说明正则"
                                value={cr.descriptionContains}
                                onChange={(e) => updateCr({ descriptionContains: e.target.value })}
                              />
                              <span className="text-[10px] text-muted-foreground">→</span>
                              <Popover open={comboOpen === cr.id} onOpenChange={(open) => { setComboOpen(open ? cr.id : null); setCategorySearch('') }}>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" className="h-6 text-[10px] px-1.5 flex-1 justify-between min-w-[80px]">
                                    <span className={cr.targetCode ? '' : 'text-muted-foreground'}>
                                      {cr.targetCode ? (allDictItems.find(d => d.code === cr.targetCode)?.label || cr.targetCode) : '选择分类...'}
                                    </span>
                                    <ChevronDown size={10} />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[260px] p-0" align="start">
                                  <div className="flex items-center border-b px-2 py-1.5">
                                    <Search size={12} className="text-muted-foreground mr-1" />
                                    <input
                                      className="flex-1 text-xs bg-transparent outline-none"
                                      placeholder="搜索分类..."
                                      value={categorySearch}
                                      onChange={(e) => setCategorySearch(e.target.value)}
                                    />
                                  </div>
                                  <div className="max-h-48 overflow-y-auto p-1">
                                    {[...groupedDictItems(type).entries()].map(([group, items]) => (
                                      <div key={group}>
                                        <p className="text-[10px] text-muted-foreground px-2 py-0.5 font-medium">
                                          {GROUP_HEADING[group] || group}
                                        </p>
                                        {items.map(d => (
                                          <button
                                            key={d.code}
                                            className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-xs hover:bg-muted rounded"
                                            onClick={() => { updateCr({ targetCode: d.code }); setComboOpen(null); setCategorySearch('') }}
                                          >
                                            <CheckCircle2 size={12} className={cr.targetCode === d.code ? 'text-[#22c55e]' : 'text-transparent'} />
                                            <span>{d.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    ))}
                                    {getFilteredDictItems(type).length === 0 && (
                                      <p className="text-[10px] text-muted-foreground text-center py-2">无匹配结果</p>
                                    )}
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <label className="flex items-center gap-0.5 text-[10px] shrink-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="size-3"
                                  checked={cr.save}
                                  onChange={(e) => updateCr({ save: e.target.checked })}
                                />
                                保存
                              </label>
                              <Button
                                variant="ghost" size="sm" className="text-[10px] h-6 px-1 shrink-0"
                                onClick={() => {
                                  const newId = String(categoryResolutions.length)
                                  setCategoryResolutions(prev => [...prev, { ...cr, id: newId, payerContains: '', descriptionContains: '' }])
                                }}
                              >
                                复制
                              </Button>
                              <Button
                                variant="ghost" size="sm" className="text-[10px] h-6 px-1 text-red-500 shrink-0"
                                onClick={() => setCategoryResolutions(prev => prev.filter(e => e.id !== cr.id))}
                              >
                                ×
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()
          )}
        </div>
      )}

      {/* 未识别记录 */}
      {tab === 'unrecognized' && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {unrecognizedRecords.length === 0 ? (
            <p className="text-muted-foreground text-xs">无未识别记录</p>
          ) : (
            unrecognizedRecords.map(r => {
              const res = unrecognizedResolutions[r.rowIndex] || { type: '', accountId: '', categoryCode: '' }
              const isResolved = res.type && res.accountId
              const updateRes = (patch: Partial<UnrecognizedResolution>) =>
                setUnrecognizedResolutions(prev => ({ ...prev, [r.rowIndex]: { ...res, ...patch } }))

              return (
                <div key={r.rowIndex} className={cn(
                  'flex items-center gap-1.5 p-1.5 rounded border text-[10px]',
                  isResolved ? 'border-[#22c55e]/30 bg-[#22c55e]/5' : 'border-orange-300 bg-orange-50',
                )}>
                  <span className="min-w-[70px]">{r.date}</span>
                  <span className="min-w-[60px] text-right font-mono">{r.amount.toFixed(2)}</span>
                  <span className="min-w-[60px] truncate">{r.accountName}</span>
                  <span className="min-w-[50px] truncate text-muted-foreground">{r.payer || '-'}</span>
                  <span className="min-w-[60px] truncate text-muted-foreground">{r.remark || '-'}</span>
                  <Select value={res.type || '__none__'} onValueChange={(v) => updateRes({ type: v === '__none__' ? '' : v, categoryCode: '' })}>
                    <SelectTrigger className="h-7 text-[10px] w-20">
                      <SelectValue placeholder="类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">-</SelectItem>
                      <SelectItem value="EXPENSE" className="text-xs">支出</SelectItem>
                      <SelectItem value="INCOME" className="text-xs">收入</SelectItem>
                      <SelectItem value="TRANSFER" className="text-xs">转账</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={res.accountId || '__none__'} onValueChange={(v) => updateRes({ accountId: v === '__none__' ? '' : v })}>
                    <SelectTrigger className="h-7 text-[10px] w-28">
                      <SelectValue placeholder="账户" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">-</SelectItem>
                      {accounts.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={res.categoryCode || '__none__'} onValueChange={(v) => updateRes({ categoryCode: v === '__none__' ? '' : v })}>
                    <SelectTrigger className="h-7 text-[10px] w-28">
                      <SelectValue placeholder="分类" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">-</SelectItem>
                      {(res.type ? allDictItems.filter(d => d.group === TYPE_TO_GROUP[res.type]) : allDictItems).map(d => (
                        <SelectItem key={d.code} value={d.code} className="text-xs">{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isResolved ? <CheckCircle2 size={12} className="text-[#22c55e] shrink-0" /> : <span className="text-[10px] text-orange-500 shrink-0">未设置</span>}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* 操作栏 */}
      <div className="border-t pt-2 space-y-1.5">
        {confirmError && (
          <div className="text-xs text-[#ef4444] bg-red-50 border border-red-200 rounded p-2">
            {confirmError}
          </div>
        )}
        {!isConfirmed ? (
          <Button
            size="sm"
            className="w-full text-xs"
            disabled={submitted}
            onClick={async () => {
              if (!toolCallId) return
              markSubmitted(toolCallId)
              setConfirmError(null)
              try {
                if (toolCallId) {
                  const overrides: Record<string, unknown> = {}
                  const fileId = aiArgs?.fileId
                  if (fileId) overrides.fileId = fileId

                  // 构建用户修改后的账户映射
                  const userAccountResolutions: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[] = []
                  for (const [csvName, res] of Object.entries(accountResolutions)) {
                    if (res.action === 'existing' && res.accountId) {
                      userAccountResolutions.push({ sourceAccountName: csvName, action: 'existing', targetAccountId: res.accountId })
                    } else if (res.action === 'create' && res.name) {
                      userAccountResolutions.push({ sourceAccountName: csvName, action: 'create', targetAccountName: res.name, accountType: res.type })
                    }
                  }
                  if (userAccountResolutions.length > 0) overrides.accountResolutions = userAccountResolutions

                  // 构建用户修改后的分类映射
                  const userCategoryResolutions: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[] = []
                  for (const cr of categoryResolutions) {
                    if (!cr.targetCode || !cr.save) continue
                    userCategoryResolutions.push({
                      sourceCategory: cr.sourceCategory,
                      targetCategoryCode: cr.targetCode,
                      recordType: cr.type,
                      payerContains: cr.payerContains || undefined,
                      descriptionContains: cr.descriptionContains || undefined,
                    })
                  }
                  if (userCategoryResolutions.length > 0) overrides.categoryResolutions = userCategoryResolutions

                  // 构建未识别记录的手动指定
                  const userUnrecognizedResolutions: { rowIndex: number; type: string; accountId: string; categoryCode: string }[] = []
                  for (const r of unrecognizedRecords) {
                    const res = unrecognizedResolutions[r.rowIndex]
                    if (res?.type && res?.accountId) {
                      userUnrecognizedResolutions.push({
                        rowIndex: r.rowIndex,
                        type: res.type,
                        accountId: res.accountId,
                        categoryCode: res.categoryCode || '',
                      })
                    }
                  }
                  if (userUnrecognizedResolutions.length > 0) overrides.unrecognizedResolutions = userUnrecognizedResolutions

                  useChatStore.getState().confirmAndContinue(
                    accountBookId,
                    toolCallId,
                    true,
                    Object.keys(overrides).length > 0 ? overrides : undefined,
                  )
                }
                // 成功：保持 submitted 标记，按钮禁用+spinner，防止重复点击
                // 后端返回 confirmed:true 后，isConfirmed 切换为「已确认」并移除按钮
              } catch (err: any) {
                setConfirmError(err?.message || '确认请求失败')
                clearSubmitted(toolCallId) // 出错复位，允许重试
              }
            }}
          >
            {submitted ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
            {submitted ? '提交中...' : '确认无误，继续导入'}
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-xs text-[#22c55e]">
            <CheckCircle2 size={14} />
            <span>已确认，等待导入...</span>
          </div>
        )}
      </div>
    </div>
  )
}
