import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { HolidayItem } from '@/api/holiday'

interface DayData {
  income: number
  expense: number
  count: number
}

interface TransactionCalendarProps {
  year: number
  month: number
  dayData: Record<string, DayData>
  highlightThreshold: number
  holidays: HolidayItem[]
  onDayClick: (date: string) => void
  onMonthChange: (year: number, month: number) => void
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function formatAmount(n: number): string {
  return n.toFixed(2)
}

export function TransactionCalendar({
  year,
  month,
  dayData,
  highlightThreshold,
  holidays,
  onDayClick,
  onMonthChange,
}: TransactionCalendarProps) {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const holidayMap = useMemo(() => {
    const map: Record<string, HolidayItem> = {}
    for (const h of holidays) {
      const d = h.date.slice(0, 10)
      map[d] = h
    }
    return map
  }, [holidays])

  const weeks = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
    const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1

    const cells: Array<{ day: number | null; dateStr: string }> = []

    for (let i = 0; i < startOffset; i++) {
      cells.push({ day: null, dateStr: '' })
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push({ day: d, dateStr })
    }

    const result: Array<Array<{ day: number | null; dateStr: string }>> = []
    for (let i = 0; i < cells.length; i += 7) {
      result.push(cells.slice(i, i + 7))
    }
    return result
  }, [year, month])

  const prevMonth = () => {
    const d = new Date(year, month - 2, 1)
    onMonthChange(d.getFullYear(), d.getMonth() + 1)
  }
  const nextMonth = () => {
    const d = new Date(year, month, 1)
    onMonthChange(d.getFullYear(), d.getMonth() + 1)
  }
  const goToday = () => {
    onMonthChange(today.getFullYear(), today.getMonth() + 1)
  }

  return (
    <div className="h-full flex flex-col select-none">
      {/* 月份导航 */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg border-border hover:bg-accent" onClick={prevMonth}>
          <ChevronLeft size={18} />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight">
            {year}年{month}月
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-sm text-amber-600 h-8 px-2.5 hover:bg-amber-50 font-medium"
            onClick={goToday}
          >
            今天
          </Button>
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg border-border hover:bg-accent" onClick={nextMonth}>
          <ChevronRight size={18} />
        </Button>
      </div>

      {/* 日历网格 */}
      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        {/* 表头 */}
        <div className="grid grid-cols-7 bg-muted/30 shrink-0">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={label}
              className="py-3 text-center text-sm font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>

        {/* 日期格子 */}
        <div className="flex-1 min-h-0 flex flex-col gap-1 p-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 flex-1 min-h-0 gap-1">
            {week.map((cell, ci) => {
              if (cell.day === null) {
                return <div key={`empty-${ci}`} className="h-full bg-muted/5 rounded-xl" />
              }

              const data = dayData[cell.dateStr]
              const holiday = holidayMap[cell.dateStr]
              const isToday = cell.dateStr === todayStr
              const expenseOverThreshold = (data?.expense ?? 0) >= highlightThreshold

              // 背景色：仅今天和超出阈值高亮
              let bgClass = ''
              if (isToday) {
                bgClass = 'bg-amber-50/70 ring-2 ring-amber-500'
              } else if (expenseOverThreshold) {
                bgClass = 'bg-rose-50/40'
              }

              // 日期颜色：仅今天和假日特殊
              let dateColor = 'text-foreground/75'
              if (isToday) {
                dateColor = 'text-amber-600'
              } else if (holiday && !holiday.isWorkday) {
                dateColor = 'text-rose-500'
              }

              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  onClick={() => onDayClick(cell.dateStr)}
                  className={`h-full p-2 flex flex-col items-center rounded-xl
                    hover:bg-accent/50 transition-colors cursor-pointer relative
                    ${bgClass}
                  `}
                >
                  {/* 今天顶部指示条 */}
                  {isToday && (
                    <div className="absolute top-0 left-2 right-2 h-0.5 rounded-full bg-amber-500" />
                  )}

                  {/* 日期数字 - 顶部 */}
                  <span className={`text-lg font-bold leading-none mt-0.5 shrink-0 ${dateColor}`}>
                    {cell.day}
                  </span>

                  {/* 节假日名称 - 顶部 */}
                  {holiday && !holiday.isWorkday && (
                    <span className="text-sm text-rose-500 font-medium truncate max-w-full leading-tight shrink-0">
                      {holiday.name}
                    </span>
                  )}
                  {holiday?.isWorkday && (
                    <span className="text-sm text-muted-foreground truncate max-w-full leading-tight shrink-0">
                      班
                    </span>
                  )}

                  {/* 金额区域 - 垂直居中 */}
                  <div className="flex-1 flex flex-col items-center justify-center gap-1 min-h-0">
                    {/* 支出金额 */}
                    {data && data.expense > 0 && (
                      <span
                        className={`text-sm leading-tight font-semibold truncate max-w-full ${
                          expenseOverThreshold
                            ? 'text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded-md'
                            : 'text-rose-500'
                        }`}
                      >
                        -{formatAmount(data.expense)}
                      </span>
                    )}

                    {/* 收入金额 */}
                    {data && data.income > 0 && (
                      <span className="text-sm text-emerald-500 leading-tight font-semibold truncate max-w-full">
                        +{formatAmount(data.income)}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
        </div>
      </div>
    </div>
  )
}
