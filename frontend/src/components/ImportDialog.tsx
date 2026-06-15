import { useState, useRef } from 'react'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { importExportApi, type UnmatchedAccount, type UnmatchedCategory, type ParsedImportRow, type DictEntry } from '@/api/import-export'
import { ACCOUNT_TYPE_LABELS, type AccountItem, type AccountType } from '@/api/account'
import { Upload, FileText, CheckCircle, AlertCircle, ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookId: string
  accounts: AccountItem[]
  dictCodes: DictEntry[]
  onImportComplete: () => void
}

type Step = 'source' | 'upload' | 'preview' | 'result'

const SOURCE_LABELS: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信',
  csv: '其他CSV',
}

const TYPE_LABELS: Record<string, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
}

const TYPE_COLORS: Record<string, string> = {
  INCOME: 'text-[#22c55e]',
  EXPENSE: 'text-[#ef4444]',
  TRANSFER: 'text-[#3b82f6]',
}

const TYPE_BG: Record<string, string> = {
  INCOME: 'bg-[#22c55e]/10 border-[#22c55e]/30',
  EXPENSE: 'bg-[#ef4444]/10 border-[#ef4444]/30',
  TRANSFER: 'bg-[#3b82f6]/10 border-[#3b82f6]/30',
}

// 记录类型 → 字典分组映射
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

function TrucCell({ text, maxW = 'max-w-[100px]', className = '' }: { text: string | null | undefined; maxW?: string; className?: string }) {
  const display = text || '-'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`truncate block ${maxW} ${className}`}>{display}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px] text-xs break-all">{display}</TooltipContent>
    </Tooltip>
  )
}

function CategoryCommandGroup({ heading, groupKey, items, selectedCode, onSelect }: {
  heading: string
  groupKey: string
  items: DictEntry[]
  selectedCode?: string
  onSelect: (code: string) => void
}) {
  const groupItems = items.filter(d => d.group === groupKey)
  if (groupItems.length === 0) return null
  return (
    <CommandGroup heading={heading} className="text-xs">
      {groupItems.map(d => (
        <CommandItem key={d.code} value={d.code} onSelect={() => onSelect(d.code)} className="text-xs">
          <CheckCircle size={12} className={selectedCode === d.code ? 'opacity-100 text-[#22c55e]' : 'opacity-0'} />
          <span>{d.code}</span>
          <span className="text-muted-foreground ml-1">{d.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

export function ImportDialog({ open, onOpenChange, bookId, accounts, dictCodes, onImportComplete }: ImportDialogProps) {
  const [step, setStep] = useState<Step>('source')
  const [source, setSource] = useState<string>('alipay')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 预览数据
  const [previewRecords, setPreviewRecords] = useState<ParsedImportRow[]>([])
  const [unmatchedAccounts, setUnmatchedAccounts] = useState<UnmatchedAccount[]>([])
  const [unmatchedCategories, setUnmatchedCategories] = useState<UnmatchedCategory[]>([])
  const [allDictItems, setAllDictItems] = useState<DictEntry[]>(dictCodes)
  const [stats, setStats] = useState<{ totalRows: number; parsedRows: number; skippedRows: number; errors: string[] } | null>(null)

  // 用户的选择
  const [accountResolutions, setAccountResolutions] = useState<Record<string, { action: 'create'; name: string; type: string } | { action: 'existing'; accountId: string }>>({})
  const [categoryResolutions, setCategoryResolutions] = useState<Record<string, { targetCode: string; save: boolean; payerContains: string; descriptionContains: string }>>({})
  const [showAllRecords, setShowAllRecords] = useState(false)
  const [comboOpen, setComboOpen] = useState<string | null>(null) // 当前打开的 combobox 对应的 sourceCategory

  // 结果
  const [importResult, setImportResult] = useState<{ imported: number; accountsCreated: number } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('source')
    setSource('alipay')
    setFile(null)
    setLoading(false)
    setError('')
    setPreviewRecords([])
    setUnmatchedAccounts([])
    setUnmatchedCategories([])
    setAllDictItems(dictCodes)
    setStats(null)
    setAccountResolutions({})
    setCategoryResolutions({})
    setShowAllRecords(false)
    setImportResult(null)
  }

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  const handleParse = async () => {
    if (!file || !bookId) return
    setLoading(true)
    setError('')
    try {
      const result = await importExportApi.preview(file, source, bookId)
      setPreviewRecords(result.records)
      setUnmatchedAccounts(result.unmatchedAccounts)
      setUnmatchedCategories(result.unmatchedCategories)
      setAllDictItems(result.allDictItems)
      setStats(result.stats)

      // 初始化账户选择
      const acctRes: typeof accountResolutions = {}
      for (const ua of result.unmatchedAccounts) {
        acctRes[ua.csvName] = { action: 'create', name: ua.suggestedName, type: ua.suggestedType }
      }
      setAccountResolutions(acctRes)

      // 初始化分类映射
      const catRes: typeof categoryResolutions = {}
      for (const uc of result.unmatchedCategories) {
        catRes[uc.sourceCategory] = { targetCode: uc.suggestedCode || '', save: true, payerContains: '', descriptionContains: '' }
      }
      setCategoryResolutions(catRes)

      setStep('preview')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    setLoading(true)
    setError('')
    try {
      // 构建账户创建列表
      const accountCreations = unmatchedAccounts
        .filter(ua => accountResolutions[ua.csvName]?.action === 'create')
        .map(ua => {
          const res = accountResolutions[ua.csvName] as { action: 'create'; name: string; type: string }
          return {
            csvName: ua.csvName,
            name: res.name,
            type: res.type,
            bankName: ua.bankName,
            accountNo: ua.accountNo,
          }
        })

      // 构建分类映射保存列表
      const newMappings = unmatchedCategories
        .filter(uc => categoryResolutions[uc.sourceCategory]?.save && categoryResolutions[uc.sourceCategory]?.targetCode)
        .map(uc => {
          const res = categoryResolutions[uc.sourceCategory]
          return {
            sourceCategory: uc.sourceCategory,
            targetCategoryCode: res.targetCode,
            payerContains: res.payerContains || undefined,
            descriptionContains: res.descriptionContains || undefined,
          }
        })

      // 构建记录列表（映射账户ID和分类）
      const records = previewRecords.map(r => {
        let accountId = r.accountId || ''
        if (!accountId && r.accountName) {
          const res = accountResolutions[r.accountName]
          if (res?.action === 'existing') {
            accountId = res.accountId
          } else if (res?.action === 'create') {
            accountId = r.accountName // 临时用名称，后端会映射
          } else {
            // 查找已有账户
            const existing = accounts.find(a => a.name === r.accountName)
            accountId = existing?.id || r.accountName
          }
        }

        let toAccountId = r.toAccountId || undefined
        if (!toAccountId && r.toAccountName) {
          const res = accountResolutions[r.toAccountName]
          if (res?.action === 'existing') {
            toAccountId = res.accountId
          } else if (res?.action === 'create') {
            toAccountId = r.toAccountName
          } else {
            const existing = accounts.find(a => a.name === r.toAccountName!)
            toAccountId = existing?.id || r.toAccountName!
          }
        }

        // 优先后端映射 → 前端手动映射 → 原始分类
        const categoryCode = r.mappedCategoryCode
          || (r.categoryCode ? categoryResolutions[r.categoryCode]?.targetCode : null)
          || r.categoryCode
          || null

        return {
          date: r.date,
          type: r.type,
          amount: r.amount,
          accountId,
          toAccountId,
          categoryCode,
          payer: r.payer,
          remark: r.remark,
          tags: r.tags,
        }
      })

      const result = await importExportApi.import({
        accountBookId: bookId,
        source,
        records,
        accountCreations,
        newMappings,
      })

      setImportResult({ imported: result.imported, accountsCreated: result.accountsCreated })
      setStep('result')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFinish = () => {
    handleClose()
    onImportComplete()
  }

  const displayRecords = showAllRecords ? previewRecords : previewRecords.slice(0, 20)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger />
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        {/* Step 1: 选择来源 */}
        {step === 'source' && (
          <>
            <DialogHeader>
              <DialogTitle>导入流水</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <p className="text-sm text-muted-foreground">选择导入来源</p>
              {[
                { key: 'alipay', label: '支付宝', desc: '支持支付宝交易明细导出CSV', disabled: false },
                { key: 'wechat', label: '微信', desc: '即将支持', disabled: true },
                { key: 'csv', label: '其他CSV', desc: '即将支持', disabled: true },
              ].map(item => (
                <button
                  key={item.key}
                  disabled={item.disabled}
                  onClick={() => !item.disabled && setSource(item.key)}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-colors ${
                    source === item.key && !item.disabled
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30'
                  } ${item.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    item.disabled ? 'bg-muted' : 'bg-primary/10'
                  }`}>
                    <FileText size={20} className={item.disabled ? 'text-muted-foreground' : 'text-primary'} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                  {source === item.key && !item.disabled && (
                    <CheckCircle size={20} className="text-primary" />
                  )}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>取消</Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={() => setStep('upload')}
              >
                下一步 <ArrowRight size={16} />
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2: 上传文件 */}
        {step === 'upload' && (
          <>
            <DialogHeader>
              <DialogTitle>上传{SOURCE_LABELS[source]}交易明细</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                  file ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted/50'
                }`}
              >
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={32} className="text-primary" />
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setFile(null) }}
                      className="text-muted-foreground text-xs"
                    >
                      重新选择
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={32} className="text-muted-foreground" />
                    <p className="text-sm font-medium">点击选择 CSV 文件</p>
                    <p className="text-xs text-muted-foreground">支持 .csv 格式，最大 10MB</p>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('source')}>
                <ArrowLeft size={16} /> 上一步
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleParse}
                disabled={!file || loading}
              >
                {loading ? <Spinner /> : '开始解析'}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 3: 预览 */}
        {step === 'preview' && (
          <>
            <DialogHeader>
              <DialogTitle>预览导入数据</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4 flex-1 overflow-y-auto">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* 统计摘要 */}
              {stats && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-2xl font-semibold">{stats.parsedRows}</p>
                    <p className="text-xs text-muted-foreground mt-1">解析成功</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-2xl font-semibold">{stats.skippedRows}</p>
                    <p className="text-xs text-muted-foreground mt-1">跳过</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-2xl font-semibold">{unmatchedAccounts.length + unmatchedCategories.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">待处理</p>
                  </div>
                </div>
              )}

              {/* 错误列表 */}
              {stats && stats.errors.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    查看 {stats.errors.length} 条跳过详情
                  </summary>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {stats.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}

              {/* 未匹配账户 */}
              {unmatchedAccounts.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">
                    <AlertCircle size={14} className="inline text-yellow-500 mr-1" />
                    未匹配的账户 ({unmatchedAccounts.length})
                  </p>
                  <div className="space-y-2">
                    {unmatchedAccounts.map(ua => {
                      const res = accountResolutions[ua.csvName]
                      return (
                        <div key={ua.csvName} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                          <span className="text-sm font-medium min-w-[100px]">{ua.csvName}</span>
                          {res?.action === 'create' ? (
                            <>
                              <Input
                                className="h-8 text-xs bg-background flex-1"
                                value={res.name}
                                onChange={(e) => setAccountResolutions({ ...accountResolutions, [ua.csvName]: { ...res, name: e.target.value } })}
                              />
                              <Select
                                value={res.type}
                                onValueChange={(v) => setAccountResolutions({ ...accountResolutions, [ua.csvName]: { ...res, type: v } })}
                              >
                                <SelectTrigger className="h-8 text-xs w-28 bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-card border-border">
                                  {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Badge variant="secondary" className="text-xs">新建</Badge>
                            </>
                          ) : (
                            <>
                              <Select
                                value={res?.action === 'existing' ? res.accountId : ''}
                                onValueChange={(v) => setAccountResolutions({ ...accountResolutions, [ua.csvName]: { action: 'existing', accountId: v } })}
                              >
                                <SelectTrigger className="h-8 text-xs flex-1 bg-background">
                                  <SelectValue placeholder="选择已有账户..." />
                                </SelectTrigger>
                                <SelectContent className="bg-card border-border">
                                  {accounts.map(a => (
                                    <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Badge variant="secondary" className="text-xs">已有</Badge>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground"
                            onClick={() => {
                              if (res?.action === 'create') {
                                setAccountResolutions({ ...accountResolutions, [ua.csvName]: { action: 'existing', accountId: accounts[0]?.id || '' } })
                              } else {
                                setAccountResolutions({ ...accountResolutions, [ua.csvName]: { action: 'create', name: ua.suggestedName, type: ua.suggestedType } })
                              }
                            }}
                          >
                            切换
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 未映射分类 */}
              {unmatchedCategories.length > 0 && (() => {
                // 按类型分组
                const grouped = new Map<string, typeof unmatchedCategories>()
                for (const uc of unmatchedCategories) {
                  for (const t of uc.types) {
                    const list = grouped.get(t) || []
                    list.push(uc)
                    grouped.set(t, list)
                  }
                }
                return (
                <div>
                  <p className="text-sm font-medium mb-2">
                    <AlertCircle size={14} className="inline text-yellow-500 mr-1" />
                    未映射的分类 ({unmatchedCategories.length})
                  </p>
                  <div className="space-y-3">
                    {(['EXPENSE', 'INCOME', 'TRANSFER'] as const).map(type => {
                      const items = grouped.get(type)
                      if (!items || items.length === 0) return null
                      return (
                      <div key={type}>
                        <Badge variant="outline" className={`text-[11px] mb-1.5 px-2 py-0.5 ${TYPE_BG[type]} ${TYPE_COLORS[type]}`}>
                          {TYPE_LABELS[type]}（{items.length}）
                        </Badge>
                        <div className="space-y-2">
                          {items.map(uc => {
                            const cr = categoryResolutions[uc.sourceCategory]
                            const selectedItem = allDictItems.find(d => d.code === cr?.targetCode)
                            const allowedGroups = (uc.types || []).map(t => TYPE_TO_GROUP[t]).filter(Boolean)
                            const filteredItems = allowedGroups.length > 0
                              ? allDictItems.filter(d => allowedGroups.includes(d.group))
                              : allDictItems
                            const updateCr = (patch: Partial<typeof cr>) => setCategoryResolutions({
                              ...categoryResolutions,
                              [uc.sourceCategory]: { ...cr, targetCode: cr?.targetCode ?? '', save: cr?.save ?? true, payerContains: cr?.payerContains ?? '', descriptionContains: cr?.descriptionContains ?? '', ...patch },
                            })
                            return (
                            <div key={uc.sourceCategory} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 flex-wrap">
                              <span className="text-sm min-w-[72px]">{uc.sourceCategory}</span>
                              <Input
                                placeholder="交易方包含"
                                value={cr?.payerContains || ''}
                                onChange={(e) => updateCr({ payerContains: e.target.value })}
                                className="h-8 text-xs w-[110px] bg-background"
                              />
                              <Input
                                placeholder="说明包含"
                                value={cr?.descriptionContains || ''}
                                onChange={(e) => updateCr({ descriptionContains: e.target.value })}
                                className="h-8 text-xs w-[110px] bg-background"
                              />
                              <span className="text-xs text-muted-foreground">→</span>
                              <Popover open={comboOpen === uc.sourceCategory} onOpenChange={(o) => setComboOpen(o ? uc.sourceCategory : null)}>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-8 text-xs flex-1 min-w-[140px] justify-between bg-background font-normal">
                                    {selectedItem ? (
                                      <span>{selectedItem.code} <span className="text-muted-foreground ml-1">{selectedItem.label}</span></span>
                                    ) : (
                                      <span className="text-muted-foreground">选择系统分类…</span>
                                    )}
                                    <ChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[260px] p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="搜索分类..." className="h-8 text-xs" />
                                    <CommandList className="max-h-56">
                                      <CommandEmpty className="text-xs py-4 text-center text-muted-foreground">无匹配分类</CommandEmpty>
                                      {allowedGroups.length > 0 ? (
                                        allowedGroups.map(g => (
                                          <CategoryCommandGroup key={g} heading={GROUP_HEADING[g]} groupKey={g} items={filteredItems} selectedCode={cr?.targetCode} onSelect={(code) => { updateCr({ targetCode: code }); setComboOpen(null) }} />
                                        ))
                                      ) : (
                                        <>
                                          <CategoryCommandGroup heading="支出分类" groupKey="transaction_category_expense" items={allDictItems} selectedCode={cr?.targetCode} onSelect={(code) => { updateCr({ targetCode: code }); setComboOpen(null) }} />
                                          <CategoryCommandGroup heading="收入分类" groupKey="transaction_category_income" items={allDictItems} selectedCode={cr?.targetCode} onSelect={(code) => { updateCr({ targetCode: code }); setComboOpen(null) }} />
                                          <CategoryCommandGroup heading="转账分类" groupKey="transaction_category_transfer" items={allDictItems} selectedCode={cr?.targetCode} onSelect={(code) => { updateCr({ targetCode: code }); setComboOpen(null) }} />
                                        </>
                                      )}
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                              <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={cr?.save ?? true}
                                  onChange={(e) => updateCr({ save: e.target.checked })}
                                  className="rounded"
                                />
                                保存
                              </label>
                            </div>
                          )})}
                        </div>
                      </div>
                    )})}
                  </div>
                </div>
              )})()}

              {/* 预览记录表 */}
              {previewRecords.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">记录预览（{previewRecords.length}条）</p>
                  <TooltipProvider>
                    <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                              <TableHead className="text-xs whitespace-nowrap py-2">类型</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">日期</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">金额</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">账户</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">目标账户</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">交易对方</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">原始分类</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">映射分类</TableHead>
                              <TableHead className="text-xs whitespace-nowrap py-2">说明</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {displayRecords.map((r, i) => (
                              <TableRow key={i} className="hover:bg-accent/50">
                                <TableCell className={`text-xs font-medium py-2 whitespace-nowrap ${TYPE_COLORS[r.type]}`}>
                                  {TYPE_LABELS[r.type]}
                                </TableCell>
                                <TableCell className="text-xs py-2 whitespace-nowrap">
                                  {new Date(r.date).toLocaleDateString('zh-CN')}
                                </TableCell>
                                <TableCell className="text-xs py-2 font-mono whitespace-nowrap">
                                  {r.amount.toFixed(2)}
                                </TableCell>
                                <TableCell className={`text-xs py-2 ${r.accountId ? '' : 'text-yellow-500'}`}>
                                  <TrucCell text={r.accountName} maxW="max-w-[80px]" />
                                </TableCell>
                                <TableCell className="text-xs py-2 text-muted-foreground">
                                  <TrucCell text={r.toAccountName} maxW="max-w-[80px]" />
                                </TableCell>
                                <TableCell className="text-xs py-2 text-muted-foreground">
                                  <TrucCell text={r.payer} maxW="max-w-[80px]" />
                                </TableCell>
                                <TableCell className={`text-xs py-2 ${r.categoryCode ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                                  <TrucCell text={r.categoryCode} maxW="max-w-[80px]" />
                                </TableCell>
                                <TableCell className={`text-xs py-2 ${r.mappedCategoryCode ? 'text-green-500' : 'text-muted-foreground'}`}>
                                  <TrucCell text={r.mappedCategoryCode} maxW="max-w-[80px]" />
                                </TableCell>
                                <TableCell className="text-xs py-2 text-muted-foreground">
                                  <TrucCell text={r.remark} maxW="max-w-[150px]" />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </TooltipProvider>
                  {previewRecords.length > 20 && (
                    <button
                      className="text-xs text-primary mt-2 hover:underline"
                      onClick={() => setShowAllRecords(!showAllRecords)}
                    >
                      {showAllRecords ? '收起' : `查看全部 ${previewRecords.length} 条`}
                    </button>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')} disabled={loading}>
                <ArrowLeft size={16} /> 上一步
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleImport}
                disabled={loading || previewRecords.length === 0}
              >
                {loading ? <Spinner /> : `导入 ${previewRecords.length} 条记录`}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 4: 结果 */}
        {step === 'result' && (
          <>
            <DialogHeader>
              <DialogTitle>导入完成</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-16 h-16 rounded-full bg-[#22c55e]/10 flex items-center justify-center">
                <CheckCircle size={36} className="text-[#22c55e]" />
              </div>
              {importResult && (
                <div className="text-center space-y-1">
                  <p className="text-lg font-semibold">成功导入 {importResult.imported} 条记录</p>
                  {importResult.accountsCreated > 0 && (
                    <p className="text-sm text-muted-foreground">同时创建了 {importResult.accountsCreated} 个新账户</p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleFinish}
              >
                完成
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
