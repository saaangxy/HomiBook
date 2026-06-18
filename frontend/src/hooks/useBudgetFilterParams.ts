import { useState, useEffect } from 'react'
import type { BudgetItem } from '@/api/budget'
import { settingsApi } from '@/api/settings'

export interface BudgetFilterParams {
  type?: string
  categoryCode?: string
  tags?: string
  dateFrom?: string
  dateTo?: string
}

export function useBudgetFilterParams(budget: BudgetItem | null) {
  const [params, setParams] = useState<BudgetFilterParams>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!budget) {
      setParams({})
      return
    }

    setLoading(true)

    if (budget.type === 'FIXED') {
      // 加载支出和收入分类代码，用于判断预算分类对应的流水类型
      Promise.all([
        settingsApi.getDictionary('transaction_category_expense'),
        settingsApi.getDictionary('transaction_category_income'),
      ])
        .then(([expenseItems, incomeItems]) => {
          const expenseCodes = new Set(expenseItems.map((d) => d.code))
          const incomeCodes = new Set(incomeItems.map((d) => d.code))

          let recordType: string | undefined
          if (budget.categoryCode && expenseCodes.has(budget.categoryCode)) {
            recordType = 'EXPENSE'
          } else if (budget.categoryCode && incomeCodes.has(budget.categoryCode)) {
            recordType = 'INCOME'
          }

          const year = budget.year
          const month = budget.month
          const lastDay = new Date(year, month, 0).getDate()
          const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
          const dateTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

          setParams({
            type: recordType,
            categoryCode: budget.categoryCode || undefined,
            dateFrom,
            dateTo,
          })
        })
        .catch(() => {
          // 字典加载失败，回退到只按分类和日期筛选
          const year = budget.year
          const month = budget.month
          const lastDay = new Date(year, month, 0).getDate()
          setParams({
            categoryCode: budget.categoryCode || undefined,
            dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
            dateTo: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
          })
        })
        .finally(() => setLoading(false))
    } else {
      // FREE 预算：按标签 + EXPENSE + 日期范围
      setParams({
        type: 'EXPENSE',
        tags: budget.tags?.length ? budget.tags.join(',') : undefined,
        dateFrom: budget.startDate?.slice(0, 10) || undefined,
        dateTo: budget.endDate?.slice(0, 10) || undefined,
      })
      setLoading(false)
    }
  }, [budget])

  return { params, loading }
}
