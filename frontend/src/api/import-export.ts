import { api } from './http'

// 预览导入 — 解析后的记录
export interface ParsedImportRow {
  date: string
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER'
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

// 预览结果
export interface ImportPreviewResult {
  records: ParsedImportRow[]
  unmatchedAccounts: UnmatchedAccount[]
  unmatchedCategories: UnmatchedCategory[]
  allDictItems: DictEntry[]
  stats: {
    totalRows: number
    parsedRows: number
    skippedRows: number
    errors: string[]
  }
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
  targetCategoryCode: string
}

export const importExportApi = {
  preview: (file: File, source: string, accountBookId: string): Promise<ImportPreviewResult> =>
    api.uploadForm('/api/records/import/preview', file, { source, accountBookId }),

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
    }[]
    accountCreations?: { csvName: string; name: string; type: string; bankName?: string; accountNo?: string }[]
    newMappings?: { sourceCategory: string; payerContains?: string; descriptionContains?: string; targetCategoryCode: string }[]
  }): Promise<ImportConfirmResult> =>
    api.post('/api/records/import', data),

  getMappings: (source?: string): Promise<{ mappings: CategoryMapping[] }> => {
    const query = source ? `?source=${encodeURIComponent(source)}` : ''
    return api.get(`/api/records/import/mappings${query}`)
  },

  saveMappings: (mappings: { source: string; sourceCategory: string; payerContains?: string; descriptionContains?: string; targetCategoryCode: string }[]): Promise<{ success: boolean }> =>
    api.post('/api/records/import/mappings', { mappings }),

  deleteMapping: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/api/records/import/mappings/${id}`),

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
