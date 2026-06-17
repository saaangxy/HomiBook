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
import dayjs from 'dayjs'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookId: string
  accounts: AccountItem[]
  dictCodes: DictEntry[]
  onImportComplete: () => void
}

type Step = 'source' | 'upload' | 'columnMapping' | 'preview' | 'confirm' | 'result'

const SOURCE_LABELS: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信',
  jd: '京东',
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
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})

  // 用户的选择
  const [accountResolutions, setAccountResolutions] = useState<Record<string, { action: 'create'; name: string; type: string } | { action: 'existing'; accountId: string }>>({})
  const [categoryResolutions, setCategoryResolutions] = useState<Record<string, { targetCode: string; save: boolean; payerContains: string; descriptionContains: string }>>({})
  const [showAllRecords, setShowAllRecords] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterAccount, setFilterAccount] = useState('')
  const [filterCategoryOpen, setFilterCategoryOpen] = useState(false)
  const [filterCategorySearch, setFilterCategorySearch] = useState('')
  const [comboOpen, setComboOpen] = useState<string | null>(null) // 当前打开的 combobox 对应的 sourceCategory
  const [categorySearch, setCategorySearch] = useState('')

  // 手动管理未映射分类：复制/删除
  const [extraUnmatched, setExtraUnmatched] = useState<Array<{ id: number; sourceCategory: string; types: string[] }>>([])
  const [nextExtraId, setNextExtraId] = useState(1)
  const [removedKeys, setRemovedKeys] = useState<Record<string, boolean>>({})

  // 无法自动识别的记录（不计收支未知类型）
  const [unrecognizedRecords, setUnrecognizedRecords] = useState<ParsedImportRow[]>([])
  const [unrecognizedResolutions, setUnrecognizedResolutions] = useState<Record<number, { type: string; accountId: string; categoryCode: string }>>({})

  // 结果
  const [importResult, setImportResult] = useState<{ imported: number; accountsCreated: number } | null>(null)

  // 通用CSV列映射
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvSampleData, setCsvSampleData] = useState<Record<string, string>[]>([])
  const [csvTotalRows, setCsvTotalRows] = useState(0)
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [typeMapping, setTypeMapping] = useState<Record<string, string>>({})
  const [csvTypeValues, setCsvTypeValues] = useState<string[]>([])
  const [headerRow, setHeaderRow] = useState<number | undefined>(undefined)

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
    setComboOpen(null)
    setCategorySearch('')
    setShowAllRecords(false)
    setFilterCategory('')
    setFilterType('')
    setFilterAccount('')
    setFilterCategoryOpen(false)
    setFilterCategorySearch('')
    setExtraUnmatched([])
    setNextExtraId(1)
    setRemovedKeys({})
    setUnrecognizedRecords([])
    setUnrecognizedResolutions({})
    setImportResult(null)
    setCsvHeaders([])
    setCsvSampleData([])
    setCsvTotalRows(0)
    setColumnMapping({})
    setTypeMapping({})
    setCsvTypeValues([])
    setAccountMappings({})
    setHeaderRow(undefined)
  }

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  // 列名自动检测
  const autoDetectColumns = (headers: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {}
    const rules: Record<string, RegExp[]> = {
      date: [/日期/, /时间/, /date/i, /time/i],
      amount: [/金额/, /金额/, /amount/i],
      type: [/收.?支/, /方向/, /类型/, /type/i, /出入/],
      account: [/支付方式/, /账户/, /付款方式/, /收款方式/, /account/i],
      toAccount: [/目标账户/, /对方账户/, /收款账户/, /toAccount/i, /to_account/i],
      payer: [/对方/, /交易方/, /商户/, /商家/, /payer/i, /merchant/i],
      category: [/分类/, /category/i],
      description: [/说明/, /商品/, /描述/, /description/i, /desc/i],
      remark: [/备注/, /remark/i, /note/i, /附言/],
    }
    for (const [field, patterns] of Object.entries(rules)) {
      for (const header of headers) {
        for (const pattern of patterns) {
          if (pattern.test(header)) {
            mapping[field] = header
            break
          }
        }
        if (mapping[field]) break
      }
    }
    return mapping
  }

  // 提取类型列的唯一值
  const detectTypeValues = (columnName: string, sampleRows: Record<string, string>[]): string[] => {
    const values = new Set<string>()
    for (const row of sampleRows) {
      const v = (row[columnName] || '').trim()
      if (v) values.add(v)
    }
    return Array.from(values)
  }

  // 自动推断类型映射（同后端正则逻辑）
  const autoDetectTypeMapping = (values: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {}
    for (const v of values) {
      if (/^收入|^入账|^收款|income/i.test(v)) mapping[v] = 'INCOME'
      else if (/^不计收支|^不计|^转账|^transfer/i.test(v)) mapping[v] = 'TRANSFER'
      else if (/^支出|^出账|^付款|^expense/i.test(v)) mapping[v] = 'EXPENSE'
    }
    return mapping
  }

  // CSV 文件分析（第一步上传）
  const handleAnalyze = async () => {
    if (!file || !bookId) return
    setLoading(true)
    setError('')
    try {
      const result = await importExportApi.analyzeCsv(file)
      setCsvHeaders(result.headers.filter(h => h !== ''))
      setCsvSampleData(result.sampleRows)
      setCsvTotalRows(result.totalRows)
      const detected = autoDetectColumns(result.headers)
      setColumnMapping(detected)
      if (detected.type) {
        const typeVals = detectTypeValues(detected.type, result.sampleRows)
        setCsvTypeValues(typeVals)
        setTypeMapping(autoDetectTypeMapping(typeVals))
      }
      setStep('columnMapping')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // CSV 带映射解析（第二步）
  const handleParseWithMapping = async () => {
    if (!file || !bookId) return
    setLoading(true)
    setError('')
    try {
      const result = await importExportApi.preview(file, source, bookId, columnMapping, typeMapping, headerRow)
      setPreviewRecords(result.records)
      setUnmatchedAccounts(result.unmatchedAccounts)
      setUnmatchedCategories(result.unmatchedCategories)
      setAllDictItems(result.allDictItems)
      setStats(result.stats)
      setUnrecognizedRecords(result.unrecognizedRecords)
      setAccountMappings(result.accountMappings || {})

      // 初始化账户选择
      const acctRes: typeof accountResolutions = {}
      for (const ua of result.unmatchedAccounts) {
        if (ua.candidates?.length) {
          acctRes[ua.csvName] = { action: 'existing', accountId: ua.candidates[0].id }
        } else {
          acctRes[ua.csvName] = { action: 'create', name: ua.suggestedName, type: ua.suggestedType }
        }
      }
      setAccountResolutions(acctRes)

      // 初始化分类映射
      const initCategoryResolutions: Record<string, { targetCode: string; save: boolean; payerContains: string; descriptionContains: string }> = {}
      for (const uc of result.unmatchedCategories) {
        for (const type of uc.types) {
          const key = `${uc.sourceCategory}::${type}`
          initCategoryResolutions[key] = {
            targetCode: uc.suggestedCode || '',
            save: false,
            payerContains: '',
            descriptionContains: '',
          }
        }
      }
      setCategoryResolutions(initCategoryResolutions)

      // 初始化无法识别记录的处理
      const initUnrecognizedResolutions: Record<number, { type: string; accountId: string; categoryCode: string }> = {}
      for (const r of result.unrecognizedRecords) {
        initUnrecognizedResolutions[r.rowIndex] = { type: '', accountId: '', categoryCode: '' }
      }
      setUnrecognizedResolutions(initUnrecognizedResolutions)

      setComboOpen(null)
      setCategorySearch('')
      setShowAllRecords(false)
      setFilterCategory('')
      setFilterType('')
      setFilterAccount('')
      setExtraUnmatched([])
      setNextExtraId(1)
      setRemovedKeys({})

      setStep('preview')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
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
      setAccountMappings(result.accountMappings || {})

      // 初始化账户选择
      const acctRes: typeof accountResolutions = {}
      for (const ua of result.unmatchedAccounts) {
        if (ua.candidates?.length) {
          acctRes[ua.csvName] = { action: 'existing', accountId: ua.candidates[0].id }
        } else {
          acctRes[ua.csvName] = { action: 'create', name: ua.suggestedName, type: ua.suggestedType }
        }
      }
      setAccountResolutions(acctRes)

      // 初始化分类映射（按 sourceCategory::type 复合键，不同类型独立映射）
      const catRes: typeof categoryResolutions = {}
      for (const uc of result.unmatchedCategories) {
        for (const t of uc.types) {
          const key = `${uc.sourceCategory}::${t}`
          catRes[key] = { targetCode: uc.suggestedCode || '', save: true, payerContains: '', descriptionContains: '' }
        }
      }
      setCategoryResolutions(catRes)

      // 初始化无法识别的记录
      setUnrecognizedRecords(result.unrecognizedRecords || [])
      const unresRes: Record<number, { type: string; accountId: string; categoryCode: string }> = {}
      for (const r of result.unrecognizedRecords || []) {
        unresRes[r.rowIndex] = {
          type: '',
          accountId: r.accountId || accounts[0]?.id || '',
          categoryCode: r.mappedCategoryCode || r.categoryCode || '',
        }
      }
      setUnrecognizedResolutions(unresRes)

      setStep('preview')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const buildImportData = () => {
    // 构建账户创建列表（合并同名账户）
    const rawCreations = unmatchedAccounts
      .filter(ua => accountResolutions[ua.csvName]?.action === 'create')
      .map(ua => {
        const res = accountResolutions[ua.csvName] as { action: 'create'; name: string; type: string }
        return {
          csvNames: [ua.csvName],
          name: res.name,
          type: res.type,
          bankName: ua.bankName,
          accountNo: ua.accountNo,
        }
      })

    // 按 name 合并
    const mergedByName = new Map<string, typeof rawCreations[0]>()
    for (const c of rawCreations) {
      const existing = mergedByName.get(c.name)
      if (existing) {
        existing.csvNames.push(...c.csvNames)
      } else {
        mergedByName.set(c.name, { ...c, csvNames: [...c.csvNames] })
      }
    }
    const accountCreations = Array.from(mergedByName.values()).map(c => ({
      csvName: c.csvNames.join(', '),
      name: c.name,
      type: c.type,
      bankName: c.bankName,
      accountNo: c.accountNo,
    }))

    // 构建分类映射保存列表
    const mappingSet = new Map<string, { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }>()
    for (const [key, res] of Object.entries(categoryResolutions)) {
      if (!res.save || !res.targetCode) continue
      const parts = key.split('::')
      const sourceCategory = parts[0]
      const recordType = parts[1] // INCOME | EXPENSE | TRANSFER
      if (removedKeys[sourceCategory]) continue
      const dedupeKey = `${sourceCategory}||${res.payerContains || ''}||${res.descriptionContains || ''}||${recordType}`
      mappingSet.set(dedupeKey, {
        sourceCategory,
        targetCategoryCode: res.targetCode,
        recordType,
        payerContains: res.payerContains || undefined,
        descriptionContains: res.descriptionContains || undefined,
      })
    }
    const newMappings = Array.from(mappingSet.values())

    // 按匹配分数从 categoryResolutions 中找最佳映射（类似后端 findBestMapping）
    const findBestResolution = (sourceCategory: string, recordType: string, payer: string | null, remark: string): string | null => {
      let best: string | null = null
      let bestScore = -1
      for (const [key, cr] of Object.entries(categoryResolutions)) {
        if (!cr.targetCode) continue
        // key 格式: sourceCategory::type 或 sourceCategory::type::eN
        const parts = key.split('::')
        if (parts[0] !== sourceCategory || parts[1] !== recordType) continue
        let score = 0
        if (cr.payerContains) {
          if (payer && payer.includes(cr.payerContains)) score += 2
          else continue
        }
        if (cr.descriptionContains) {
          if (remark && remark.includes(cr.descriptionContains)) score += 1
          else continue
        }
        if (score > bestScore) {
          bestScore = score
          best = cr.targetCode
        }
      }
      return best
    }

    // 构建记录列表
    const records = previewRecords.map(r => {
      let accountId = r.accountId || ''
      if (!accountId && r.accountName) {
        const res = accountResolutions[r.accountName]
        if (res?.action === 'existing') {
          accountId = res.accountId
        } else if (res?.action === 'create') {
          accountId = res.name
        } else {
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
          toAccountId = res.name
        } else {
          const existing = accounts.find(a => a.name === r.toAccountName!)
          toAccountId = existing?.id || r.toAccountName!
        }
      }

      // 用户前端配置的条件化映射优先于后端通用映射
      const userResolution = r.categoryCode ? findBestResolution(r.categoryCode, r.type, r.payer, r.remark) : null
      const categoryCode = userResolution
        || r.mappedCategoryCode
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
        // 保留原始信息供确认页展示
        _accountName: r.accountName,
        _toAccountName: r.toAccountName,
      }
    })

    const resolvedUnrecognized = unrecognizedRecords
      .filter(r => {
        const res = unrecognizedResolutions[r.rowIndex]
        return res?.type && res?.accountId
      })
      .map(r => {
        const res = unrecognizedResolutions[r.rowIndex]
        return {
          date: r.date,
          type: res.type,
          amount: r.amount,
          accountId: res.accountId,
          toAccountId: undefined as string | undefined,
          categoryCode: res.categoryCode || r.mappedCategoryCode || r.categoryCode || null,
          payer: r.payer,
          remark: r.remark,
          tags: r.tags,
        }
      })

    // 构建账户映射保存列表
    const accountIdToName = new Map(accounts.map(a => [a.id, a.name]))
    for (const c of accountCreations) {
      accountIdToName.set(c.name, c.name)
    }
    const accountMappingSet = new Map<string, { sourceAccountName: string; targetAccountName: string }>()
    for (const r of records) {
      const csvName = r._accountName
      if (!csvName) continue
      const targetName = accountIdToName.get(r.accountId) || r.accountId
      if (targetName === csvName) continue
      const key = `${csvName}||${targetName}`
      if (!accountMappingSet.has(key)) {
        accountMappingSet.set(key, { sourceAccountName: csvName, targetAccountName: targetName })
      }
    }
    const newAccountMappings = Array.from(accountMappingSet.values())

    return { accountCreations, newMappings, newAccountMappings, records, resolvedUnrecognized }
  }

  const handleImport = async () => {
    setLoading(true)
    setError('')
    try {
      const { accountCreations, newMappings, newAccountMappings, records, resolvedUnrecognized } = buildImportData()
      const allRecords = [...records.map(({ _accountName, _toAccountName, ...r }) => r), ...resolvedUnrecognized]

      const result = await importExportApi.import({
        accountBookId: bookId,
        source,
        records: allRecords,
        accountCreations,
        newMappings,
        newAccountMappings,
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

  const filteredRecords = previewRecords.filter(r => {
    if (filterCategory && r.categoryCode !== filterCategory) return false
    if (filterType && r.type !== filterType) return false
    if (filterAccount && r.accountName !== filterAccount) return false
    return true
  })
  const displayRecords = showAllRecords ? filteredRecords : filteredRecords.slice(0, 20)

  const uniqueCategories = [...new Set(previewRecords.map(r => r.categoryCode).filter(Boolean))] as string[]
  const uniqueTypes = [...new Set(previewRecords.map(r => r.type))]
  const uniqueAccounts = [...new Set(previewRecords.map(r => r.accountName).filter(Boolean))] as string[]

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger />
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        {/* Step 1: 选择来源 */}
        {step === 'source' && (
          <>
            <DialogHeader>
              <DialogTitle>导入流水</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <p className="text-sm text-muted-foreground">选择导入来源</p>
              {[
                { key: 'alipay', label: '支付宝', desc: '支持支付宝交易明细导出CSV (.csv)', disabled: false },
                { key: 'wechat', label: '微信', desc: '支持微信支付账单导出Excel (.xlsx)', disabled: false },
                { key: 'jd', label: '京东', desc: '支持京东交易流水导出CSV (.csv)', disabled: false },
                { key: 'csv', label: '其他CSV', desc: '支持任意CSV文件，需手动配置列映射', disabled: false },
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
                accept={source === 'wechat' ? '.xlsx' : '.csv'}
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
                    <p className="text-sm font-medium">点击选择 {source === 'wechat' ? 'Excel' : 'CSV'} 文件</p>
                    <p className="text-xs text-muted-foreground">支持 {source === 'wechat' ? '.xlsx' : '.csv'} 格式，最大 10MB</p>
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
                onClick={source === 'csv' ? handleAnalyze : handleParse}
                disabled={!file || loading}
              >
                {loading ? <Spinner /> : '开始解析'}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2.5: 列映射 (仅CSV) */}
        {step === 'columnMapping' && (
          <>
            <DialogHeader>
              <DialogTitle>配置列映射 - 其他CSV</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4 flex-1 overflow-y-auto">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText size={14} />
                <span>{file?.name}</span>
                <span>·</span>
                <span>{csvTotalRows} 行数据</span>
                <span>·</span>
                <span>{csvHeaders.length} 列</span>
              </div>

              {/* 表头行号调整 */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">表头行号</label>
                <Input
                  type="number"
                  min={1}
                  placeholder="自动检测"
                  value={headerRow ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setHeaderRow(v ? Math.max(1, parseInt(v) || 1) : undefined)
                  }}
                  className="h-8 text-xs w-24"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={loading}
                  onClick={async () => {
                    if (!file || !bookId) return
                    setLoading(true)
                    setError('')
                    try {
                      const result = await importExportApi.analyzeCsv(file, headerRow)
                      setCsvHeaders(result.headers.filter(h => h !== ''))
                      setCsvSampleData(result.sampleRows)
                      setCsvTotalRows(result.totalRows)
                      const detected = autoDetectColumns(result.headers)
                      setColumnMapping(detected)
                      if (detected.type) {
                        const typeVals = detectTypeValues(detected.type, result.sampleRows)
                        setCsvTypeValues(typeVals)
                        setTypeMapping(autoDetectTypeMapping(typeVals))
                      }
                    } catch (e: any) {
                      setError(e.message)
                    } finally {
                      setLoading(false)
                    }
                  }}
                >
                  {loading ? <Spinner /> : '重新分析'}
                </Button>
              </div>

              {/* 列映射表 */}
              <div>
                <p className="text-sm font-medium mb-2">系统字段映射（<span className="text-red-400">*</span> 必填）</p>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="text-xs py-2 w-28">系统字段</TableHead>
                        <TableHead className="text-xs py-2">CSV 列名</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {([
                        { key: 'date', label: '日期', required: true },
                        { key: 'amount', label: '金额', required: true },
                        { key: 'type', label: '收支类型', required: true },
                        { key: 'account', label: '账户' },
                        { key: 'toAccount', label: '目标账户' },
                        { key: 'payer', label: '交易方' },
                        { key: 'category', label: '分类' },
                        { key: 'description', label: '说明' },
                        { key: 'remark', label: '备注' },
                      ] as { key: string; label: string; required?: boolean }[]).map(field => (
                        <TableRow key={field.key}>
                          <TableCell className="text-xs py-2 font-medium">
                            {field.label}
                            {field.required && <span className="text-red-400 ml-0.5">*</span>}
                          </TableCell>
                          <TableCell className="text-xs py-2">
                            <Select
                              value={columnMapping[field.key] || ''}
                              onValueChange={(v) => {
                                const newMapping = { ...columnMapping }
                                if (v === '') {
                                  delete newMapping[field.key]
                                } else {
                                  newMapping[field.key] = v
                                }
                                setColumnMapping(newMapping)
                                if (field.key === 'type' && v) {
                                  const typeVals = detectTypeValues(v, csvSampleData)
                                  setCsvTypeValues(typeVals)
                                  setTypeMapping(autoDetectTypeMapping(typeVals))
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs w-full bg-background">
                                <SelectValue placeholder="选择 CSV 列..." />
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border max-h-56">
                                {csvHeaders.map(h => (
                                  <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* 类型值映射 */}
              {csvTypeValues.length > 0 && columnMapping.type && (
                <div>
                  <p className="text-sm font-medium mb-2">收支类型值映射</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    将CSV中"{columnMapping.type}"列的值映射到系统收支类型
                  </p>
                  <div className="space-y-2">
                    {csvTypeValues.map(csvVal => (
                      <div key={csvVal} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                        <span className="text-sm font-medium min-w-[80px]">{csvVal}</span>
                        <span className="text-xs text-muted-foreground">→</span>
                        <Select
                          value={typeMapping[csvVal] || ''}
                          onValueChange={(v) => setTypeMapping({ ...typeMapping, [csvVal]: v })}
                        >
                          <SelectTrigger className="h-8 text-xs w-24 bg-background">
                            <SelectValue placeholder="选择" />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            <SelectItem value="EXPENSE" className="text-xs text-[#ef4444]">支出</SelectItem>
                            <SelectItem value="INCOME" className="text-xs text-[#22c55e]">收入</SelectItem>
                            <SelectItem value="TRANSFER" className="text-xs text-[#3b82f6]">转账</SelectItem>
                          </SelectContent>
                        </Select>
                        {!typeMapping[csvVal] && (
                          <span className="text-xs text-orange-500">未映射</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 数据预览 */}
              {csvSampleData.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">数据预览（前 {csvSampleData.length} 行）</p>
                  <div className="border rounded-lg overflow-hidden max-h-48 overflow-auto">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            {csvHeaders.map(h => (
                              <TableHead key={h} className="text-xs whitespace-nowrap py-2 px-3">
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {csvSampleData.map((row, i) => (
                            <TableRow key={i} className="hover:bg-accent/50">
                              {csvHeaders.map(h => (
                                <TableCell key={h} className="text-xs py-2 px-3 whitespace-nowrap">
                                  {row[h] || '-'}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')} disabled={loading}>
                <ArrowLeft size={16} /> 上一步
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleParseWithMapping}
                disabled={
                  !columnMapping.date || !columnMapping.amount || !columnMapping.type ||
                  loading
                }
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
              <DialogTitle>预览数据</DialogTitle>
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
                    <p className="text-2xl font-semibold">{unmatchedAccounts.length + unmatchedCategories.length + unrecognizedRecords.length}</p>
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

              {/* 已匹配账户（通过导入账户映射规则自动匹配） */}
              {Object.keys(accountMappings).length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    <CheckCircle size={14} className="inline text-green-500 mr-1" />
                    已匹配的账户 ({Object.keys(accountMappings).length})
                  </p>
                  <div className="space-y-1 mb-3">
                    {Object.entries(accountMappings).map(([csvName, targetName]) => (
                      <div key={csvName} className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 text-xs">
                        <span className="font-medium">{csvName}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-green-600 dark:text-green-400">{targetName}</span>
                        <CheckCircle size={12} className="text-green-500 ml-auto" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 未匹配账户 */}
              {unmatchedAccounts.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    <AlertCircle size={14} className="inline text-yellow-500 mr-1" />
                    未匹配的账户 ({unmatchedAccounts.length})
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    同一银行账户可能有多个名称变体（如"农业银行储蓄卡"和"中国农业银行"），设为相同名称即可合并为一个账户
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
                                  {(ua.candidates || accounts).map(a => (
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
              {(unmatchedCategories.length > 0 || extraUnmatched.length > 0) && (() => {
                // 合并并过滤
                const allUnmatched = [
                  ...unmatchedCategories.filter(uc => !removedKeys[uc.sourceCategory]),
                  ...extraUnmatched.filter(eu => !removedKeys[`e${eu.id}`]),
                ]
                if (allUnmatched.length === 0) return null
                // 按类型分组
                const grouped = new Map<string, typeof allUnmatched>()
                for (const uc of allUnmatched) {
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
                    未映射的分类 ({allUnmatched.length})
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
                            const extraId = (uc as any).id as number | undefined
                            const compositeKey = extraId ? `${uc.sourceCategory}::${type}::e${extraId}` : `${uc.sourceCategory}::${type}`
                            const cr = categoryResolutions[compositeKey]
                            const selectedItem = allDictItems.find(d => d.code === cr?.targetCode)
                            const allowedGroups = [TYPE_TO_GROUP[type]].filter(Boolean)
                            const filteredItems = allDictItems.filter(d => allowedGroups.includes(d.group))
                            const updateCr = (patch: Partial<typeof cr>) => setCategoryResolutions({
                              ...categoryResolutions,
                              [compositeKey]: { ...cr, targetCode: cr?.targetCode ?? '', save: cr?.save ?? true, payerContains: cr?.payerContains ?? '', descriptionContains: cr?.descriptionContains ?? '', ...patch },
                            })
                            return (
                            <div key={compositeKey} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 flex-wrap">
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
                              <Popover open={comboOpen === compositeKey} onOpenChange={(o) => { setComboOpen(o ? compositeKey : null); setCategorySearch('') }} modal={true}>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-8 text-xs flex-1 min-w-[140px] justify-between bg-background font-normal">
                                    {selectedItem ? (
                                      <span>{selectedItem.label}</span>
                                    ) : (
                                      <span className="text-muted-foreground">选择系统分类…</span>
                                    )}
                                    <ChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[260px] p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                                  <Input
                                    placeholder="搜索分类..."
                                    value={categorySearch}
                                    onChange={(e) => setCategorySearch(e.target.value)}
                                    className="h-8 text-xs mb-2"
                                  />
                                  <div className="max-h-56 overflow-y-auto">
                                    {(() => {
                                      const groups = allowedGroups.length > 0 ? allowedGroups : ['transaction_category_expense', 'transaction_category_income', 'transaction_category_transfer']
                                      const baseItems = allowedGroups.length > 0 ? filteredItems : allDictItems
                                      const searchResults = baseItems.filter(d =>
                                        !categorySearch || d.label.includes(categorySearch) || d.code.includes(categorySearch)
                                      )
                                      if (searchResults.length === 0) {
                                        return <div className="text-xs py-4 text-center text-muted-foreground">无匹配分类</div>
                                      }
                                      return groups.map(g => {
                                        const items = searchResults.filter(d => d.group === g)
                                        if (items.length === 0) return null
                                        return (
                                          <div key={g} className="mb-1">
                                            <div className="text-[11px] text-muted-foreground px-2 py-0.5 font-medium">{GROUP_HEADING[g]}</div>
                                            {items.map(d => (
                                              <button
                                                key={d.code}
                                                className={`flex items-center gap-1.5 w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent ${cr?.targetCode === d.code ? 'bg-accent' : ''}`}
                                                onClick={() => { updateCr({ targetCode: d.code }); setComboOpen(null); setCategorySearch('') }}
                                              >
                                                <CheckCircle size={12} className={cr?.targetCode === d.code ? 'text-[#22c55e]' : 'text-transparent'} />
                                                {d.label}
                                              </button>
                                            ))}
                                          </div>
                                        )
                                      })
                                    })()}
                                  </div>
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
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  const newId = nextExtraId
                                  setNextExtraId(newId + 1)
                                  setExtraUnmatched([...extraUnmatched, { id: newId, sourceCategory: uc.sourceCategory, types: [type] }])
                                  const key = `${uc.sourceCategory}::${type}::e${newId}`
                                  const orig = categoryResolutions[compositeKey]
                                  setCategoryResolutions({ ...categoryResolutions, [key]: { targetCode: '', save: true, payerContains: orig?.payerContains || '', descriptionContains: orig?.descriptionContains || '' } })
                                }}
                                title="复制"
                              >
                                复制
                              </Button>
                              {extraId !== undefined && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-xs text-muted-foreground hover:text-red-500"
                                  onClick={() => setRemovedKeys({ ...removedKeys, [`e${extraId}`]: true })}
                                  title="删除"
                                >
                                  ×
                                </Button>
                              )}
                            </div>
                          )})}
                        </div>
                      </div>
                    )})}
                  </div>
                </div>
              )})()}

              {/* 无法自动识别的记录 */}
              {unrecognizedRecords.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">
                    <AlertCircle size={14} className="inline text-orange-500 mr-1" />
                    需手动处理的记录 ({unrecognizedRecords.length})
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    以下记录无法自动识别类型，请手动设置类型、账户和分类后导入。未设置的记录将被跳过。
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {unrecognizedRecords.map(r => {
                      const res = unrecognizedResolutions[r.rowIndex]
                      const isResolved = !!(res?.type && res?.accountId)
                      const updateRes = (patch: Partial<typeof res>) => {
                        const cur = unrecognizedResolutions[r.rowIndex] || { type: '', accountId: '', categoryCode: '' }
                        setUnrecognizedResolutions({ ...unrecognizedResolutions, [r.rowIndex]: { ...cur, ...patch } })
                      }
                      // 按类型筛选可选分类
                      const resolvedType = res?.type
                      const allowedGroup = resolvedType ? TYPE_TO_GROUP[resolvedType] : null
                      const filteredCategories = allowedGroup
                        ? allDictItems.filter(d => d.group === allowedGroup)
                        : allDictItems
                      return (
                        <div key={r.rowIndex} className={`flex items-center gap-2 p-3 rounded-lg border text-xs ${isResolved ? 'border-[#22c55e]/30 bg-[#22c55e]/5' : 'border-orange-300 bg-orange-50 dark:bg-orange-950/20'}`}>
                          <span className="font-mono whitespace-nowrap text-muted-foreground">{new Date(r.date).toLocaleDateString('zh-CN')}</span>
                          <span className="font-mono whitespace-nowrap">{r.amount.toFixed(2)}</span>
                          <TrucCell text={r.accountName} maxW="max-w-[60px]" />
                          <TrucCell text={r.payer} maxW="max-w-[60px]" className="text-muted-foreground" />
                          <TrucCell text={r.remark} maxW="max-w-[120px]" className="text-muted-foreground" />
                          <Select value={res?.type || ''} onValueChange={(v) => updateRes({ type: v, categoryCode: '' })}>
                            <SelectTrigger className="h-8 text-xs w-20 shrink-0 bg-background">
                              <SelectValue placeholder="类型" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border">
                              <SelectItem value="EXPENSE" className="text-xs">支出</SelectItem>
                              <SelectItem value="INCOME" className="text-xs">收入</SelectItem>
                              <SelectItem value="TRANSFER" className="text-xs">转账</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={res?.accountId || ''} onValueChange={(v) => updateRes({ accountId: v })}>
                            <SelectTrigger className="h-8 text-xs w-28 shrink-0 bg-background">
                              <SelectValue placeholder="选择账户" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border max-h-48">
                              {accounts.map(a => (
                                <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={res?.categoryCode || ''} onValueChange={(v) => updateRes({ categoryCode: v })}>
                            <SelectTrigger className="h-8 text-xs w-32 shrink-0 bg-background">
                              <SelectValue placeholder="选择分类" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border max-h-48">
                              {filteredCategories.map(d => (
                                <SelectItem key={d.code} value={d.code} className="text-xs">
                                  {d.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isResolved ? (
                            <CheckCircle size={14} className="text-[#22c55e] shrink-0" />
                          ) : (
                            <span className="text-[10px] text-orange-500 shrink-0">未设置</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 预览记录表 */}
              {previewRecords.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <p className="text-sm font-medium">记录预览（{filteredRecords.length}条{filteredRecords.length !== previewRecords.length ? ` / 共${previewRecords.length}条` : ''}）</p>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Select value={filterType || 'all'} onValueChange={(v) => setFilterType(v === 'all' ? '' : v)}>
                        <SelectTrigger className="h-7 text-xs w-20 bg-background">
                          <SelectValue placeholder="类型" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="all" className="text-xs">全部类型</SelectItem>
                          {uniqueTypes.map(t => (
                            <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t] || t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Popover open={filterCategoryOpen} onOpenChange={(o) => { setFilterCategoryOpen(o); if (!o) setFilterCategorySearch('') }} modal={true}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs w-28 justify-between bg-background font-normal">
                            <span className={filterCategory ? '' : 'text-muted-foreground'}>
                              {filterCategory || '原始分类'}
                            </span>
                            <ChevronDown size={12} className="opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                          <Input
                            placeholder="搜索分类..."
                            value={filterCategorySearch}
                            onChange={(e) => setFilterCategorySearch(e.target.value)}
                            className="h-8 text-xs mb-2"
                          />
                          <div className="max-h-48 overflow-y-auto">
                            {(() => {
                              const filtered = filterCategorySearch
                                ? uniqueCategories.filter(c => c.toLowerCase().includes(filterCategorySearch.toLowerCase()))
                                : uniqueCategories
                              return (
                                <>
                                  <button
                                    className={`flex items-center gap-1.5 w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent ${!filterCategory ? 'bg-accent' : ''}`}
                                    onClick={() => { setFilterCategory(''); setFilterCategoryOpen(false) }}
                                  >
                                    <CheckCircle size={12} className={!filterCategory ? 'text-[#22c55e]' : 'text-transparent'} />
                                    全部分类
                                  </button>
                                  {filtered.map(c => (
                                    <button
                                      key={c}
                                      className={`flex items-center gap-1.5 w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent ${filterCategory === c ? 'bg-accent' : ''}`}
                                      onClick={() => { setFilterCategory(c); setFilterCategoryOpen(false) }}
                                    >
                                      <CheckCircle size={12} className={filterCategory === c ? 'text-[#22c55e]' : 'text-transparent'} />
                                      {c}
                                    </button>
                                  ))}
                                </>
                              )
                            })()}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Select value={filterAccount || 'all'} onValueChange={(v) => setFilterAccount(v === 'all' ? '' : v)}>
                        <SelectTrigger className="h-7 text-xs w-28 bg-background">
                          <SelectValue placeholder="账户" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-48">
                          <SelectItem value="all" className="text-xs">全部账户</SelectItem>
                          {uniqueAccounts.map(a => (
                            <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
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
                              <TableHead className="text-xs whitespace-nowrap py-2">交易方</TableHead>
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
                                  {dayjs(r.date).format('YYYY-MM-DD HH:mm:ss')}
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
                  {filteredRecords.length > 20 && (
                    <button
                      className="text-xs text-primary mt-2 hover:underline"
                      onClick={() => setShowAllRecords(!showAllRecords)}
                    >
                      {showAllRecords ? '收起' : `查看全部 ${filteredRecords.length} 条`}
                    </button>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(source === 'csv' ? 'columnMapping' : 'upload')} disabled={loading}>
                <ArrowLeft size={16} /> 上一步
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={() => { setFilterType(''); setFilterCategory(''); setFilterAccount(''); setStep('confirm') }}
                disabled={previewRecords.length === 0 && unrecognizedRecords.filter(r => unrecognizedResolutions[r.rowIndex]?.type && unrecognizedResolutions[r.rowIndex]?.accountId).length === 0}
              >
                下一步：确认导入
                <ArrowRight size={16} />
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 4: 确认导入 */}
        {step === 'confirm' && (() => {
          const { accountCreations, records, resolvedUnrecognized } = buildImportData()
          const allRecordCount = records.length + resolvedUnrecognized.length
          const incomeCount = records.filter(r => r.type === 'INCOME').length + resolvedUnrecognized.filter(r => r.type === 'INCOME').length
          const expenseCount = records.filter(r => r.type === 'EXPENSE').length + resolvedUnrecognized.filter(r => r.type === 'EXPENSE').length
          const transferCount = records.filter(r => r.type === 'TRANSFER').length + resolvedUnrecognized.filter(r => r.type === 'TRANSFER').length
          const incomeSum = records.filter(r => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0) + resolvedUnrecognized.filter(r => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0)
          const expenseSum = records.filter(r => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0) + resolvedUnrecognized.filter(r => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0)
          const transferSum = records.filter(r => r.type === 'TRANSFER').reduce((s, r) => s + r.amount, 0) + resolvedUnrecognized.filter(r => r.type === 'TRANSFER').reduce((s, r) => s + r.amount, 0)
          return (
            <>
              <DialogHeader>
                <DialogTitle>确认导入</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* 账户创建概览 */}
                {accountCreations.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">将创建 {accountCreations.length} 个新账户：</p>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead className="text-xs">账户名称</TableHead>
                            <TableHead className="text-xs">类型</TableHead>
                            <TableHead className="text-xs">CSV 原始名</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {accountCreations.map((ac, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-sm py-2">{ac.name}</TableCell>
                              <TableCell className="text-xs py-2">{ACCOUNT_TYPE_LABELS[ac.type as AccountType] || ac.type}</TableCell>
                              <TableCell className="text-xs text-muted-foreground py-2">{ac.csvName}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* 流水概览 */}
                <div>
                  <p className="text-sm font-medium mb-2">将导入 {allRecordCount} 条流水记录：</p>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="border rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground">收入</p>
                      <p className="text-sm font-semibold text-[#22c55e]">{incomeCount} 条</p>
                      <p className="text-xs text-[#22c55e]">¥{incomeSum.toFixed(2)}</p>
                    </div>
                    <div className="border rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground">支出</p>
                      <p className="text-sm font-semibold text-[#ef4444]">{expenseCount} 条</p>
                      <p className="text-xs text-[#ef4444]">¥{expenseSum.toFixed(2)}</p>
                    </div>
                    <div className="border rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground">转账</p>
                      <p className="text-sm font-semibold text-[#3b82f6]">{transferCount} 条</p>
                      <p className="text-xs text-[#3b82f6]">¥{transferSum.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* 全部记录预览 */}
                  {(() => {
                    const allRecords = [...records, ...resolvedUnrecognized] as any[]
                    const cfTypes = [...new Set(allRecords.map(r => r.type))]
                    const cfCategories = [...new Set(allRecords.map(r => r.categoryCode).filter(Boolean))] as string[]
                    const cfAccounts = [...new Set(allRecords.map(r => r._accountName).filter(Boolean))] as string[]
                    const filteredConfirm = allRecords.filter(r => {
                      if (filterType && r.type !== filterType) return false
                      if (filterCategory && r.categoryCode !== filterCategory) return false
                      if (filterAccount && r._accountName !== filterAccount) return false
                      return true
                    })
                    return (
                      <>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <p className="text-sm font-medium">记录列表（{filteredConfirm.length}条{filteredConfirm.length !== allRecords.length ? ` / 共${allRecords.length}条` : ''}）</p>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <Select value={filterType || 'all'} onValueChange={(v) => setFilterType(v === 'all' ? '' : v)}>
                              <SelectTrigger className="h-7 text-xs w-20 bg-background">
                                <SelectValue placeholder="类型" />
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border">
                                <SelectItem value="all" className="text-xs">全部类型</SelectItem>
                                {cfTypes.map(t => (
                                  <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t] || t}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Popover open={filterCategoryOpen} onOpenChange={(o) => { setFilterCategoryOpen(o); if (!o) setFilterCategorySearch('') }} modal={true}>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 text-xs w-28 justify-between bg-background font-normal">
                                  <span className={filterCategory ? '' : 'text-muted-foreground'}>
                                    {filterCategory || '分类'}
                                  </span>
                                  <ChevronDown size={12} className="opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-52 p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                                <Input
                                  placeholder="搜索分类..."
                                  value={filterCategorySearch}
                                  onChange={(e) => setFilterCategorySearch(e.target.value)}
                                  className="h-8 text-xs mb-2"
                                />
                                <div className="max-h-48 overflow-y-auto">
                                  <button
                                    className={`flex items-center gap-1.5 w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent ${!filterCategory ? 'bg-accent' : ''}`}
                                    onClick={() => { setFilterCategory(''); setFilterCategoryOpen(false) }}
                                  >
                                    <CheckCircle size={12} className={!filterCategory ? 'text-[#22c55e]' : 'text-transparent'} />
                                    全部分类
                                  </button>
                                  {cfCategories
                                    .filter(c => !filterCategorySearch || c.toLowerCase().includes(filterCategorySearch.toLowerCase()))
                                    .map(c => (
                                      <button
                                        key={c}
                                        className={`flex items-center gap-1.5 w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent ${filterCategory === c ? 'bg-accent' : ''}`}
                                        onClick={() => { setFilterCategory(c); setFilterCategoryOpen(false) }}
                                      >
                                        <CheckCircle size={12} className={filterCategory === c ? 'text-[#22c55e]' : 'text-transparent'} />
                                        {c}
                                      </button>
                                    ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                            <Select value={filterAccount || 'all'} onValueChange={(v) => setFilterAccount(v === 'all' ? '' : v)}>
                              <SelectTrigger className="h-7 text-xs w-24 bg-background">
                                <SelectValue placeholder="账户" />
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border max-h-48">
                                <SelectItem value="all" className="text-xs">全部账户</SelectItem>
                                {cfAccounts.map(a => (
                                  <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                          <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="text-xs whitespace-nowrap py-2">日期</TableHead>
                                <TableHead className="text-xs whitespace-nowrap py-2">类型</TableHead>
                                <TableHead className="text-xs whitespace-nowrap py-2">金额</TableHead>
                                <TableHead className="text-xs whitespace-nowrap py-2">账户</TableHead>
                                <TableHead className="text-xs whitespace-nowrap py-2">目标账户</TableHead>
                                <TableHead className="text-xs whitespace-nowrap py-2">交易方</TableHead>
                                <TableHead className="text-xs whitespace-nowrap py-2">分类</TableHead>
                                <TableHead className="text-xs whitespace-nowrap py-2">备注</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredConfirm.map((r: any, i: number) => (
                                <TableRow key={i} className="hover:bg-accent/50">
                                  <TableCell className="text-xs py-2 whitespace-nowrap">
                                    {dayjs(r.date).format('YYYY-MM-DD HH:mm:ss')}
                                  </TableCell>
                                  <TableCell className={`text-xs font-medium py-2 whitespace-nowrap ${TYPE_COLORS[r.type] || ''}`}>
                                    {TYPE_LABELS[r.type] || r.type}
                                  </TableCell>
                                  <TableCell className="text-xs py-2 font-mono whitespace-nowrap">
                                    {r.amount.toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-xs py-2">
                                    <TrucCell text={r._accountName} maxW="max-w-[80px]" />
                                  </TableCell>
                                  <TableCell className="text-xs py-2 text-muted-foreground">
                                    <TrucCell text={r._toAccountName} maxW="max-w-[80px]" />
                                  </TableCell>
                                  <TableCell className="text-xs py-2 text-muted-foreground">
                                    <TrucCell text={r.payer} maxW="max-w-[80px]" />
                                  </TableCell>
                                  <TableCell className="text-xs py-2 text-muted-foreground">
                                    <TrucCell text={r.categoryCode} maxW="max-w-[80px]" />
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
                      </>
                    )
                  })()}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep('preview')} disabled={loading}>
                  <ArrowLeft size={16} /> 返回修改
                </Button>
                <Button
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={handleImport}
                  disabled={loading}
                >
                  {loading ? <Spinner /> : `确认导入 ${allRecordCount} 条记录`}
                </Button>
              </DialogFooter>
            </>
          )
        })()}

        {/* Step 5: 结果 */}
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
