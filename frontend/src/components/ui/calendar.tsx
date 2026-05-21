"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from "date-fns"
import { zhCN } from "date-fns/locale"

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

  const monthDays = React.useMemo(() => {
    const start = startOfMonth(viewDate)
    const end = endOfMonth(viewDate)
    return eachDayOfInterval({ start, end })
  }, [viewDate])

  const handleSelect = (day: Date) => {
    if (mode === "single") {
      onSelect?.(day)
    }
  }

  const weekDays = ['一', '二', '三', '四', '五', '六', '日']

  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i)
  const months = [
    { value: 0, label: '1 月' },
    { value: 1, label: '2 月' },
    { value: 2, label: '3 月' },
    { value: 3, label: '4 月' },
    { value: 4, label: '5 月' },
    { value: 5, label: '6 月' },
    { value: 6, label: '7 月' },
    { value: 7, label: '8 月' },
    { value: 8, label: '9 月' },
    { value: 9, label: '10 月' },
    { value: 10, label: '11 月' },
    { value: 11, label: '12 月' },
  ]

  return (
    <div className={cn("p-3", className)}>
      {captionLayout === "dropdown" ? (
        <div className="flex items-center justify-between mb-3 gap-2">
          <Select
            value={viewDate.getFullYear().toString()}
            onValueChange={(v) => setViewDate(new Date(parseInt(v), viewDate.getMonth(), 1))}
          >
            <SelectTrigger className="h-8 w-24 text-sm bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y} 年</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={viewDate.getMonth().toString()}
            onValueChange={(v) => setViewDate(new Date(viewDate.getFullYear(), parseInt(v), 1))}
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDate(subMonths(viewDate, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDate(addMonths(viewDate, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-3">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDate(subMonths(viewDate, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">
            {format(viewDate, 'yyyy 年 MM 月', { locale: zhCN })}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDate(addMonths(viewDate, 1))}>
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
          const firstDay = startOfMonth(viewDate)
          const dayOfWeek = (firstDay.getDay() + 6) % 7
          return Array.from({ length: dayOfWeek })
        })().map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}

        {monthDays.map((day) => {
          const isSelected = selected && isSameDay(day, selected)
          const isToday = isSameDay(day, new Date())
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
              {format(day, 'd')}
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
            setViewDate(new Date())
            onSelect?.(new Date())
          }}
        >
          今天
        </Button>
      </div>
    </div>
  )
}