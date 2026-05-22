"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
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
  const [inputValue, setInputValue] = React.useState(value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "")

  const selectedDate = value ? dayjs(value).toDate() : undefined

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const minutes = Array.from({ length: 60 }, (_, i) => i)
  const seconds = Array.from({ length: 60 }, (_, i) => i)

  const [hour, setHour] = React.useState(() => value ? dayjs(value).hour() : dayjs().hour())
  const [minute, setMinute] = React.useState(() => value ? dayjs(value).minute() : dayjs().minute())
  const [second, setSecond] = React.useState(() => value ? dayjs(value).second() : dayjs().second())

  const hourScrollRef = React.useRef<HTMLDivElement>(null)
  const minuteScrollRef = React.useRef<HTMLDivElement>(null)
  const secondScrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (value) {
      setInputValue(dayjs(value).format("YYYY-MM-DD HH:mm:ss"))
    }
  }, [value])

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const result = dayjs(date).hour(hour).minute(minute).second(second)
      onChange(result.format("YYYY-MM-DDTHH:mm:ss"))
    }
  }

  const handleTimeChange = (type: "hour" | "minute" | "second", val: number) => {
    if (type === "hour") {
      setHour(val)
      const newDate = selectedDate ? dayjs(selectedDate).hour(val).minute(minute).second(second) : dayjs().hour(val).minute(minute).second(second)
      onChange(newDate.format("YYYY-MM-DDTHH:mm:ss"))
    } else if (type === "minute") {
      setMinute(val)
      const newDate = selectedDate ? dayjs(selectedDate).hour(hour).minute(val).second(second) : dayjs().hour(hour).minute(val).second(second)
      onChange(newDate.format("YYYY-MM-DDTHH:mm:ss"))
    } else {
      setSecond(val)
      const newDate = selectedDate ? dayjs(selectedDate).hour(hour).minute(minute).second(val) : dayjs().hour(hour).minute(minute).second(val)
      onChange(newDate.format("YYYY-MM-DDTHH:mm:ss"))
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputBlur = () => {
    const parsed = dayjs(inputValue, "YYYY-MM-DD HH:mm:ss", true)
    if (parsed.isValid()) {
      const result = parsed.hour(hour).minute(minute).second(second)
      onChange(result.format("YYYY-MM-DDTHH:mm:ss"))
    } else {
      setInputValue(value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleInputBlur()
    }
  }

  const scrollToTime = React.useCallback((scrollRef: React.RefObject<HTMLDivElement | null>, value: number) => {
    if (scrollRef.current) {
      // parentElement is ScrollArea -> parentElement is ScrollAreaRoot
      const scrollAreaRoot = scrollRef.current.parentElement?.parentElement as HTMLElement | null
      if (scrollAreaRoot) {
        const itemHeight = 44
        const targetScrollTop = value * itemHeight
        scrollAreaRoot.scrollTop = Math.max(0, targetScrollTop)
      }
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      setTimeout(() => {
        scrollToTime(hourScrollRef, hour)
        scrollToTime(minuteScrollRef, minute)
        scrollToTime(secondScrollRef, second)
      }, 0)
    }
  }, [open, hour, minute, second, scrollToTime])

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>, _type: "hour" | "minute" | "second") => {
    e.preventDefault()
    e.stopPropagation()
    // Only scroll, do not change selected time
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "w-full h-9 px-3 font-normal bg-background border-border focus:outline-none focus:ring-2 focus:ring-[#f97316] [&::-webkit-inner-spin-button]:appearance-none",
            !value && "text-muted-foreground",
            className
          )}
        />
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
              <div
                ref={hourScrollRef}
                className="flex sm:flex-col p-2"
                onWheel={(e) => handleWheel(e, "hour")}
              >
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
              <div
                ref={minuteScrollRef}
                className="flex sm:flex-col p-2"
                onWheel={(e) => handleWheel(e, "minute")}
              >
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
            {/* 秒 */}
            <ScrollArea className="w-48 sm:w-auto sm:h-full">
              <div
                ref={secondScrollRef}
                className="flex sm:flex-col p-2"
                onWheel={(e) => handleWheel(e, "second")}
              >
                {seconds.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleTimeChange("second", s)}
                    className={cn(
                      "h-9 w-9 rounded-md text-sm font-medium transition-colors shrink-0",
                      second === s
                        ? "bg-[#f97316] text-white hover:bg-[#ea580c]"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {String(s).padStart(2, '0')}
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