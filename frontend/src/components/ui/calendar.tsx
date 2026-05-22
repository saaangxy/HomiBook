"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import dayjs from "dayjs"

export interface CalendarProps {
  mode?: "single"
  selected?: Date | undefined
  defaultMonth?: Date
  captionLayout?: "dropdown"
  onSelect?: (date: Date | undefined) => void
  className?: string
}

export function Calendar({
  mode = "single",
  selected,
  defaultMonth,
  captionLayout,
  onSelect,
  className,
}: CalendarProps) {
  const [viewDate, setViewDate] = React.useState(defaultMonth || new Date())

  const year = dayjs(viewDate).year()
  const month = dayjs(viewDate).month()
  const daysInMonth = dayjs(viewDate).daysInMonth()

  const monthDays = React.useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) =>
      dayjs(viewDate).date(i + 1).toDate()
    )
  }, [viewDate, daysInMonth])

  const handleSelect = (day: Date) => {
    if (mode === "single") {
      onSelect?.(day)
    }
  }

  const weekDays = ['一', '二', '三', '四', '五', '六', '日']

  const years = React.useMemo(() => Array.from({ length: 10 }, (_, i) => dayjs().year() - 5 + i), [])
  const months = [
    { value: 0, label: '1' }, { value: 1, label: '2' }, { value: 2, label: '3' },
    { value: 3, label: '4' }, { value: 4, label: '5' }, { value: 5, label: '6' },
    { value: 6, label: '7' }, { value: 7, label: '8' }, { value: 8, label: '9' },
    { value: 9, label: '10' }, { value: 10, label: '11' }, { value: 11, label: '12' },
  ]

  const goToPrevMonth = () => setViewDate(dayjs(viewDate).subtract(1, 'month').toDate())
  const goToNextMonth = () => setViewDate(dayjs(viewDate).add(1, 'month').toDate())

  const selectedDayjs = selected ? dayjs(selected) : null
  const today = dayjs()

  const isSameDay = (d1: Date | dayjs.Dayjs, d2: Date | dayjs.Dayjs) => dayjs(d1).isSame(dayjs(d2), 'day')

  return (
    <div className={cn("p-3", className)}>
      {captionLayout === "dropdown" ? (
        <div className="flex items-center justify-between mb-3 gap-2">
          <Select
            value={year.toString()}
            onValueChange={(v) => setViewDate(dayjs(viewDate).year(parseInt(v)).toDate())}
          >
            <SelectTrigger className="h-8 w-24 text-sm bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={month.toString()}
            onValueChange={(v) => setViewDate(dayjs(viewDate).month(parseInt(v)).toDate())}
          >
            <SelectTrigger className="h-8 w-24 text-sm bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToPrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-3">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToPrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">
            {dayjs(viewDate).format('YYYY 年 MM 月')}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekDays.map((d) => (
          <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {(() => {
          const firstDay = dayjs(viewDate).date(1).day()
          const dayOfWeek = (firstDay + 6) % 7
          return Array.from({ length: dayOfWeek })
        })().map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}

        {monthDays.map((day) => {
          const isSelected = selectedDayjs && isSameDay(day, selectedDayjs)
          const isToday = isSameDay(day, today)
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => handleSelect(day)}
              className={cn(
                "h-8 w-8 rounded-md text-sm transition-colors",
                isSelected
                  ? "bg-[#f97316] text-white hover:bg-[#ea580c]"
                  : isToday
                  ? "bg-muted text-foreground font-medium hover:bg-accent"
                  : "hover:bg-accent"
              )}
            >
              {dayjs(day).date()}
            </button>
          )
        })}
      </div>

      <div className="mt-3 pt-3 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => {
            setViewDate(today.toDate())
            onSelect?.(today.toDate())
          }}
        >
          今天
        </Button>
      </div>
    </div>
  )
}
