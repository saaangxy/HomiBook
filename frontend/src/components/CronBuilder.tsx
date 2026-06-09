import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import cronstrue from 'cronstrue/i18n'

export interface CronBuilderProps {
  value?: string
  onChange: (cronExpression: string) => void
  className?: string
}

const SCHEDULE_TYPES = [
  { value: 'never', label: '从不' },
  { value: 'hour', label: '每小时' },
  { value: 'day', label: '每天' },
  { value: 'week', label: '每周' },
  { value: 'month', label: '每月' },
  { value: 'year', label: '每年' },
  { value: 'custom', label: '自定义' },
] as const

const MINUTES_ALL = Array.from({ length: 60 }, (_, i) => i)
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1)
const COMMON_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function parseCron(expr: string): {
  type: string
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
  custom: string
} {
  const empty = { type: 'never', minutes: [0], hours: [0], daysOfMonth: [1], months: [1], daysOfWeek: [0], custom: '' }
  if (!expr) return empty

  const parts = expr.trim().split(' ')
  if (parts.length !== 5) {
    return { ...empty, type: 'custom', custom: expr }
  }

  const [min, hour, dom, month, dow] = parts

  const parseNums = (p: string): number[] => {
    if (p === '*' || p === '?') return []
    return p.split(',').map(Number).filter(n => !isNaN(n))
  }

  const mins = parseNums(min)
  const hrs = parseNums(hour)
  const doms = parseNums(dom)
  const dows = parseNums(dow)

  if (mins.length === 0 && hrs.length === 0 && doms.length === 0 && dows.length === 0) {
    return empty
  }

  // 每小时: min * * * ?
  if (mins.length > 0 && hour === '*' && dom === '*' && month === '*' && dow === '?') {
    return { ...empty, type: 'hour', minutes: mins }
  }
  // 每天: min hour * * ?
  if (mins.length > 0 && hrs.length > 0 && dom === '*' && month === '*' && dow === '?') {
    return { ...empty, type: 'day', minutes: mins, hours: hrs }
  }
  // 每周: min hour ? * dow
  if (mins.length > 0 && hrs.length > 0 && dom === '?' && month === '*' && dows.length > 0) {
    return { ...empty, type: 'week', minutes: mins, hours: hrs, daysOfWeek: dows }
  }
  // 每月: min hour dom * ?
  if (mins.length > 0 && hrs.length > 0 && doms.length > 0 && month === '*' && dow === '?') {
    return { ...empty, type: 'month', minutes: mins, hours: hrs, daysOfMonth: doms }
  }
  // 每年: min hour dom month ?
  if (mins.length > 0 && hrs.length > 0 && doms.length > 0 && month !== '*' && dow === '?') {
    const months = parseNums(month)
    return { ...empty, type: 'year', minutes: mins, hours: hrs, daysOfMonth: doms, months }
  }
  return { ...empty, type: 'custom', custom: expr }
}

function buildCron(
  type: string,
  minutes: number[],
  hours: number[],
  daysOfMonth: number[],
  months: number[],
  daysOfWeek: number[],
  custom: string,
): string {
  const m = (arr: number[], total: number) =>
    arr.length === 0 || arr.length === total ? '*' : arr.join(',')

  switch (type) {
    case 'never': return ''
    case 'hour': return `${m(minutes, 60)} * * * ?`
    case 'day': return `${m(minutes, 60)} ${m(hours, 24)} * * ?`
    case 'week': return `${m(minutes, 60)} ${m(hours, 24)} ? * ${m(daysOfWeek, 7)}`
    case 'month': return `${m(minutes, 60)} ${m(hours, 24)} ${m(daysOfMonth, 31)} * ?`
    case 'year': return `${m(minutes, 60)} ${m(hours, 24)} ${m(daysOfMonth, 31)} ${m(months, 12)} ?`
    case 'custom': return custom || ''
    default: return ''
  }
}

const btnBase = 'px-2 py-1 text-xs rounded border transition-colors'
const btnSelected = `${btnBase} bg-primary text-primary-foreground border-primary`
const btnDefault = `${btnBase} bg-background text-foreground border-border hover:bg-primary/10 hover:text-primary`

function GridButton({ value, isSelected, onClick, children, minWidth = '36px' }: {
  value: number
  isSelected: boolean
  onClick: (v: number) => void
  children?: React.ReactNode
  minWidth?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={isSelected ? btnSelected : btnDefault}
      style={{ minWidth }}
    >
      {children ?? String(value).padStart(2, '0')}
    </button>
  )
}

export function CronBuilder({ value, onChange, className }: CronBuilderProps) {
  const internalChange = useRef(false)

  const [scheduleType, setScheduleType] = useState(() => parseCron(value || '').type)
  const [minutes, setMinutes] = useState<number[]>(() => parseCron(value || '').minutes)
  const [hours, setHours] = useState<number[]>(() => parseCron(value || '').hours)
  const [daysOfMonth, setDaysOfMonth] = useState<number[]>(() => parseCron(value || '').daysOfMonth)
  const [months, setMonths] = useState<number[]>(() => parseCron(value || '').months)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(() => parseCron(value || '').daysOfWeek)
  const [custom, setCustom] = useState(() => parseCron(value || '').custom)
  const [showAllMinutes, setShowAllMinutes] = useState(false)

  // 当外部 value 变化时同步内部状态
  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false
      return
    }
    const p = parseCron(value || '')
    setScheduleType(p.type)
    setMinutes(p.minutes)
    setHours(p.hours)
    setDaysOfMonth(p.daysOfMonth)
    setMonths(p.months)
    setDaysOfWeek(p.daysOfWeek)
    setCustom(p.custom)
  }, [value])

  const cron = useMemo(
    () => buildCron(scheduleType, minutes, hours, daysOfMonth, months, daysOfWeek, custom),
    [scheduleType, minutes, hours, daysOfMonth, months, daysOfWeek, custom],
  )

  // 内部状态变化 → 通知父组件
  useEffect(() => {
    internalChange.current = true
    onChange(cron)
  }, [cron])

  const cronText = useMemo(() => {
    try {
      if (!cron) return null
      return cronstrue.toString(cron, { locale: 'zh_CN' })
    } catch {
      return null
    }
  }, [cron])

  const resetToDefaults = useCallback(() => {
    setMinutes([0]); setHours([0]); setDaysOfMonth([1]); setMonths([1]); setDaysOfWeek([0])
  }, [])

  const toggle = useCallback(<T,>(arr: T[], val: T) =>
    arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val],
  [])

  const minutesToShow = useMemo(() => showAllMinutes ? MINUTES_ALL : COMMON_MINUTES, [showAllMinutes])

  return (
    <div className={`flex flex-col flex-grow ${className || ''}`}>
      {/* 调度类型选择 */}
      <div className="inline-flex items-center justify-center border border-border rounded-md overflow-hidden w-fit">
        {SCHEDULE_TYPES.map(({ value: sv, label }, idx) => (
          <button
            key={sv}
            type="button"
            onClick={() => { setScheduleType(sv); resetToDefaults() }}
            className={`inline-flex items-center justify-center text-xs font-medium transition-colors h-8 px-3
              ${idx === 0 ? 'rounded-l-md' : ''}
              ${idx === SCHEDULE_TYPES.length - 1 ? 'rounded-r-md' : ''}
              ${scheduleType === sv ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}
            `}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {scheduleType === 'never' ? (
          <p className="text-sm text-muted-foreground">未配置计划</p>
        ) : scheduleType === 'custom' ? (
          <div className="flex flex-col gap-2 p-3 bg-card border border-border rounded-md">
            <label className="text-xs font-medium">Cron 表达式</label>
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="flex h-9 w-[50%] rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="0 0 * * 0"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* 分钟 */}
            <div className="flex flex-col gap-2 w-fit">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium">分钟</label>
                <span className="text-xs text-muted-foreground">({showAllMinutes ? '全部' : '常用'})</span>
                <button type="button" onClick={() => setShowAllMinutes(!showAllMinutes)}
                  className="px-1 pb-0.5 text-xs border border-border rounded hover:bg-accent transition-colors">
                  {showAllMinutes ? '−' : '+'}
                </button>
              </div>
              <div className={`grid gap-1 w-fit ${showAllMinutes ? 'grid-cols-12' : 'grid-cols-6'}`}>
                {minutesToShow.map((m) => (
                  <GridButton key={m} value={m} isSelected={minutes.includes(m)}
                    onClick={(v) => setMinutes(prev => toggle(prev, v))} />
                ))}
              </div>
            </div>

            {/* 小时 */}
            {scheduleType !== 'hour' && (
              <div className="flex flex-col gap-2 w-fit">
                <label className="text-xs font-medium">小时</label>
                <div className="grid grid-cols-6 gap-1 w-fit">
                  {HOURS.map((h) => (
                    <GridButton key={h} value={h} isSelected={hours.includes(h)}
                      onClick={(v) => setHours(prev => toggle(prev, v))} />
                  ))}
                </div>
              </div>
            )}

            {/* 星期 */}
            {scheduleType === 'week' && (
              <div className="flex flex-col gap-2 w-full">
                <label className="text-xs font-medium">星期</label>
                <div className="flex flex-row gap-1 justify-start w-full">
                  {DAY_LABELS.map((day, i) => (
                    <button key={i} type="button"
                      onClick={() => setDaysOfWeek(prev => toggle(prev, i))}
                      className={`px-3 py-1 text-center text-xs ${daysOfWeek.includes(i) ? btnSelected : btnDefault} ${i === 0 || i === 6 ? 'text-orange-500' : ''}`}
                      style={{ minWidth: '50px' }}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 月份 */}
            {scheduleType === 'year' && (
              <div className="flex flex-col gap-2 w-fit">
                <label className="text-xs font-medium">月份</label>
                <div className="grid grid-cols-3 gap-1 w-fit">
                  {MONTH_LABELS.map((m, i) => (
                    <button key={i} type="button"
                      onClick={() => setMonths(prev => toggle(prev, i + 1))}
                      className={`px-3 py-1 ${months.includes(i + 1) ? btnSelected : btnDefault}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 日期 */}
            {(scheduleType === 'month' || scheduleType === 'year') && (
              <div className="flex flex-col gap-2 w-fit">
                <label className="text-xs font-medium">日期</label>
                <div className="grid grid-cols-7 gap-1 w-fit">
                  {DAYS_OF_MONTH.map((d) => (
                    <GridButton key={d} value={d} isSelected={daysOfMonth.includes(d)}
                      onClick={(v) => setDaysOfMonth(prev => toggle(prev, v))} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cron 描述 */}
        {cron && (
          <div className="mt-3">
            {cronText ? (
              <p className="bg-card text-card-foreground p-3 rounded-sm overflow-clip text-sm">
                {cronText} <span className="font-mono bg-accent text-accent-foreground rounded-sm p-1 px-2">cron({cron})</span>
              </p>
            ) : (
              <p className="bg-destructive text-destructive-foreground p-3 rounded-sm text-sm">无效的 cron 表达式</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default CronBuilder
