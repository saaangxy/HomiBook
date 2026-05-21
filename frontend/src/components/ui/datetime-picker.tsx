"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import dayjs from "dayjs"
import { Calendar as CalendarIcon } from "lucide-react"

interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function DateTimePicker({ value, onChange, placeholder = "选择日期时间", className }: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  const selectedDate = value ? dayjs(value).toDate() : undefined

  const [timeValue, setTimeValue] = React.useState(() => {
    if (value) return dayjs(value).format("HH:mm")
    return ""
  })

  const handleSelect = (date: Date | undefined) => {
    if (!date) { setOpen(false); return }
    const [h, m] = timeValue ? timeValue.split(":").map(Number) : [0, 0]
    const result = dayjs(date).hour(h).minute(m).second(0)
    onChange(result.format("YYYY-MM-DDTHH:mm"))
    setOpen(false)
  }

  const handleTimeChange = (time: string) => {
    setTimeValue(time)
    if (selectedDate) {
      const [h, m] = time.split(":").map(Number)
      const result = dayjs(selectedDate).hour(h).minute(m).second(0)
      onChange(result.format("YYYY-MM-DDTHH:mm"))
    }
  }

  const displayValue = value ? dayjs(value).format("YYYY年MM月DD日 HH:mm") : ""

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left h-9 px-3 font-normal bg-background border-border hover:bg-accent",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 text-[#f97316]" />
          {value ? <span>{displayValue}</span> : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start" side="bottom">
        <div className="p-3">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate || new Date()}
            captionLayout="dropdown"
            onSelect={handleSelect}
          />
          <div className="mt-3 pt-3 border-t">
            <Input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="bg-background border-border h-9 text-sm"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
