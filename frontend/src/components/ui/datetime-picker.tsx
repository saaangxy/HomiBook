"use client"

import * as React from "react"
import { CalendarIcon } from "@radix-ui/react-icons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import dayjs from "dayjs"

export interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function DateTimePicker({ value, onChange, placeholder = "选择日期时间", className }: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  const selectedDate = value ? dayjs(value).toDate() : undefined

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5)

  const [hour, setHour] = React.useState(() => value ? dayjs(value).hour() : dayjs().hour())
  const [minute, setMinute] = React.useState(() => value ? dayjs(value).minute() : dayjs().minute())

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const result = dayjs(date).hour(hour).minute(minute).second(0)
      onChange(result.format("YYYY-MM-DDTHH:mm"))
    }
  }

  const handleTimeChange = (type: "hour" | "minute", val: number) => {
    if (type === "hour") {
      setHour(val)
      const newDate = selectedDate ? dayjs(selectedDate).hour(val).minute(minute).second(0) : dayjs().hour(val).minute(minute).second(0)
      onChange(newDate.format("YYYY-MM-DDTHH:mm"))
    } else {
      setMinute(val)
      const newDate = selectedDate ? dayjs(selectedDate).hour(hour).minute(val).second(0) : dayjs().hour(hour).minute(val).second(0)
      onChange(newDate.format("YYYY-MM-DDTHH:mm"))
    }
  }

  const displayValue = value ? dayjs(value).format("YYYY年MM月DD日 HH:mm") : ""

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal bg-background border-border hover:bg-accent",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 text-[#f97316]" />
          {value ? <span>{displayValue}</span> : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <div className="sm:flex">
          <div className="p-3 border-r">
            <Calendar
              mode="single"
              selected={selectedDate}
              defaultMonth={selectedDate || new Date()}
              captionLayout="dropdown"
              onSelect={handleDateSelect}
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:h-[300px] divide-y sm:divide-y-0 sm:divide-x">
            {/* 小时 */}
            <ScrollArea className="w-48 sm:w-auto sm:h-full">
              <div className="flex sm:flex-col p-2">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => handleTimeChange("hour", h)}
                    className={cn(
                      "h-9 w-9 rounded-md text-sm font-medium transition-colors shrink-0",
                      hour === h
                        ? "bg-[#f97316] text-white hover:bg-[#ea580c]"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {String(h).padStart(2, '0')}
                  </button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
              <ScrollBar orientation="vertical" />
            </ScrollArea>
            {/* 分钟 */}
            <ScrollArea className="w-48 sm:w-auto sm:h-full">
              <div className="flex sm:flex-col p-2">
                {minutes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleTimeChange("minute", m)}
                    className={cn(
                      "h-9 w-9 rounded-md text-sm font-medium transition-colors shrink-0",
                      minute === m
                        ? "bg-[#f97316] text-white hover:bg-[#ea580c]"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {String(m).padStart(2, '0')}
                  </button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
              <ScrollBar orientation="vertical" />
            </ScrollArea>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}