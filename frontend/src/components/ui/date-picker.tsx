"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import dayjs from "dayjs"
import { Calendar as CalendarIcon, X } from "lucide-react"

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function DatePicker({ value, onChange, placeholder = "选择日期", className }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selectedDate = value ? dayjs(value).toDate() : undefined

  const handleSelect = (date: Date | undefined) => {
    if (date) onChange(dayjs(date).format("YYYY-MM-DD"))
    setOpen(false)
  }

  const displayValue = value ? dayjs(value).format("YYYY年MM月DD日") : ""

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
          {value && (
            <span
              className="ml-auto h-4 w-4 shrink-0 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); onChange('') }}
            >
              <X size={14} />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start" side="bottom">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate || new Date()}
          captionLayout="dropdown"
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  )
}
