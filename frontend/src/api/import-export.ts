import { api } from './http'
import { IMPORT_AI_SOURCES } from '@homibook/core'

/** 服务端能自动识别的账单来源(AI 导入工具支持的三种,与 core 同源) */
export type BillSource = (typeof IMPORT_AI_SOURCES)[number]

// 预览导入 — 解析后的记录
export interface ParsedImportRow {
  date: string
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN'
  amount: number
  accountName: string
  accountId: string | null
  toAccountName: string | null
  toAccountId: string | null
  categoryCode: string | null
  mappedCategoryCode: string | null
  payer: string | null
  remark: string
  tags: string[]
  rowIndex: number
}

// 未匹配的账户
export interface UnmatchedAccount {
  csvName: string
  suggestedType: string
  suggestedName: string
  bankName?: string
  accountNo?: string
  candidates?: { id: string; name: string }[]  // 多个候选匹配时提供
}

// 未映射的分类
export interface UnmatchedCategory {
  sourceCategory: string
  suggestedCode: string | null
  types: string[]  // 该分类在数据中出现的记录类型：INCOME | EXPENSE | TRANSFER
}

export interface DictEntry {
  code: string
  label: string
  group: string
}

/** 阻断项(服务端 D 项):willFailAtImport=true 表示不处理必然失败 */
export interface PreviewBlockingItem {
  kind: 'account' | 'category' | 'unrecognized'
  ref: string
  reason: string
  willFailAtImport: boolean
}

// 预览结果
export interface ImportPreviewResult {
  records: ParsedImportRow[]
  unrecognizedRecords: ParsedImportRow[]
  unmatchedAccounts: UnmatchedAccount[]
  unmatchedCategories: UnmatchedCategory[]
  allDictItems: DictEntry[]
  accountMappings: Record<string, string>  // csvName → targetAccountName
  /** 阻断项:必然失败 / 会写脏数据的项 */
  blocking?: PreviewBlockingItem[]
  /** **服务端唯一裁决**:能否进入下一步 / 确认导入(前端直接采用,不再自行判定) */
  canProceed?: boolean
  /** canProceed 为 false 时的逐条原因(人类可读) */
  blockReasons?: string[]
  /** 预览阶段会被跳过的行数 */
  skipped?: { unrecognized: number }
  /** C 项:应用全部决议后「实际会写入」的流水(第二步据此校验"零残留") */
  finalRecords?: ParsedImportRow[]
  /** C 项:未决清单 */
  unresolved?: { accounts: string[]; categories: string[]; unrecognized: number[] }
  /** C 项:进度计数(与 core computeImportProgress 同口径) */
  counts?: {
    accountsTotal: number
    accountsResolved: number
    accountsDefault: number
    categoriesTotal: number
    categoriesResolved: number
    unrecognizedTotal: number
    unrecognizedResolved: number
    pending: number
    mapped: number
    willSkip: number
    blocking: number
  }
  stats: {
    totalRows: number
    parsedRows: number
    skippedRows: number
    unrecognizedCount: number
    errors: string[]
  }
}

// CSV 文件分析结果
export interface CsvAnalyzeResult {
  encoding: string
  headers: string[]
  sampleRows: Record<string, string>[]
  totalRows: number
}

// 导入确认结果
export interface ImportConfirmResult {
  imported: number
  accountsCreated: number
  newAccountIds: Record<string, string>
}

// 分类映射
export interface CategoryMapping {
  id: string
  source: string
  sourceCategory: string
  payerContains: string
  descriptionContains: string
  recordType: string
  targetCategoryCode: string
  /** 服务端标记:目标分类编码已不在字典中(AI 早期可能把源分类名当编码写进来) */
  invalidCode?: boolean
}

// 账户映射
export interface AccountMapping {
  id: string
  source: string
  sourceAccountName: string
  payerContains: string
  descriptionContains: string
  targetAccountName: string
}

export const importExportApi = {
  /**
   * 上传账单文件。服务端把它落成一个**附件**并返回 attachmentId —— AI 侧统一只认 attachmentId,
   * 不再有 fileId。detectedSource 由服务端按文件内容识别,认不出为 null。
   */
  uploadImportFile: (file: File): Promise<{ attachmentId: string; url: string; filename: string; size: number; detectedSource: BillSource | null }> =>
    api.uploadForm('/api/records/import/upload', file, {}),

  preview: (
    file: File,
    source: string,
    accountBookId: string,
    columnMapping?: Record<string, string>,
    typeMapping?: Record<string, string>,
    headerRow?: number,
    /** C 项:第二步带上当前决议,让服务端按同一条流程重算(返回 finalRecords/unresolved/counts/blocking) */
    resolutions?: {
      ownerId?: string
      accountResolutions?: unknown[]
      categoryResolutions?: unknown[]
      unrecognizedResolutions?: unknown[]
      /** 是否已同意跳过未处置的未识别行(服务端裁决需要) */
      confirmSkipUnrecognized?: boolean
    },
  ): Promise<ImportPreviewResult> => {
    const extraFields: Record<string, string> = { source, accountBookId }
    if (columnMapping) {
      extraFields.columnMapping = JSON.stringify(columnMapping)
    }
    if (typeMapping) {
      extraFields.typeMapping = JSON.stringify(typeMapping)
    }
    if (headerRow !== undefined && headerRow > 0) {
      extraFields.headerRow = String(headerRow)
    }
    if (resolutions) {
      if (resolutions.ownerId) extraFields.ownerId = resolutions.ownerId
      if (resolutions.accountResolutions?.length) extraFields.accountResolutions = JSON.stringify(resolutions.accountResolutions)
      if (resolutions.categoryResolutions?.length) extraFields.categoryResolutions = JSON.stringify(resolutions.categoryResolutions)
      if (resolutions.unrecognizedResolutions?.length) extraFields.unrecognizedResolutions = JSON.stringify(resolutions.unrecognizedResolutions)
      if (resolutions.confirmSkipUnrecognized) extraFields.confirmSkipUnrecognized = 'true'
    }
    return api.uploadForm('/api/records/import/preview', file, extraFields)
  },

  analyzeCsv: (file: File, headerRow?: number): Promise<CsvAnalyzeResult> => {
    const fields: Record<string, string> = {}
    if (headerRow !== undefined && headerRow > 0) {
      fields.headerRow = String(headerRow)
    }
    return api.uploadForm('/api/records/import/csv/analyze', file, fields)
  },

  import: (data: {
    accountBookId: string
    source: string
    records: {
      date: string
      type: string
      amount: number
      accountId: string
      toAccountId?: string
      categoryCode?: string | null
      payer?: string | null
      remark?: string
      tags?: string[]
      ownerId?: string
    }[]
    accountCreations?: { csvName: string; name: string; type: string; bankName?: string; accountNo?: string; ownerId?: string }[]
    newMappings?: { sourceCategory: string; payerContains?: string; descriptionContains?: string; recordType?: string; targetCategoryCode: string }[]
    newAccountMappings?: { sourceAccountName: string; targetAccountName: string; payerContains?: string; descriptionContains?: string }[]
    /** 跳过的未识别行数 + 显式确认(服务端校验:>0 且未确认则 400) */
    skippedUnrecognized?: number
    confirmSkipUnrecognized?: boolean
  }): Promise<ImportConfirmResult> =>
    api.post('/api/records/import', data),

  getMappings: (source?: string): Promise<{ mappings: CategoryMapping[] }> => {
    const query = source ? `?source=${encodeURIComponent(source)}` : ''
    return api.get(`/api/records/import/mappings${query}`)
  },

  saveMappings: (mappings: { source: string; sourceCategory: string; payerContains?: string; descriptionContains?: string; recordType?: string; targetCategoryCode: string }[]): Promise<{ success: boolean }> =>
    api.post('/api/records/import/mappings', { mappings }),

  deleteMapping: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/api/records/import/mappings/${id}`),

  /** 清理目标分类不在字典中的分类映射(脏规则) */
  cleanupInvalidCategoryMappings: (): Promise<{ removed: number }> =>
    api.post('/api/records/import/mappings/cleanup', {}),

  /** H 项:列出等价重复规则(按归一化后的唯一键分组) */
  getDuplicateMappings: (kind: 'category' | 'account'): Promise<{ kind: string; groups: { ids: string[]; items: Record<string, unknown>[] }[] }> =>
    api.get(`/api/records/import/mappings/duplicates?kind=${kind}`),

  /** H 项:合并同一组重复规则(保留一条,删除其余) */
  mergeMappings: (body: { kind: 'category' | 'account'; ids: string[]; strategy?: 'keep-first' | 'keep-target'; target?: string }): Promise<{ keptId: string; merged: number }> =>
    api.post('/api/records/import/mappings/merge', body),

  getAccountMappings: (source?: string): Promise<{ mappings: AccountMapping[] }> => {
    const query = source ? `?source=${encodeURIComponent(source)}` : ''
    return api.get(`/api/records/import/account-mappings${query}`)
  },

  saveAccountMappings: (mappings: { source: string; sourceAccountName: string; payerContains?: string; descriptionContains?: string; targetAccountName: string }[]): Promise<{ success: boolean }> =>
    api.post('/api/records/import/account-mappings', { mappings }),

  deleteAccountMapping: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/api/records/import/account-mappings/${id}`),

  exportCsv: async (params: Record<string, string | number>) => {
    const queryParts: string[] = []
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      }
    }
    const url = `/api/records/export?${queryParts.join('&')}`
    const token = (() => {
      try {
        const raw = localStorage.getItem('auth-storage')
        if (!raw) return null
        return JSON.parse(raw)?.state?.token || null
      } catch { return null }
    })()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(url, { headers })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: '导出失败' }))
      throw new Error(error.message || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `records_export_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  },
}
