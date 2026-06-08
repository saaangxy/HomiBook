"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
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

const ITEM_H = 36
const COL_W = 56
const CONTAINER_H = 176 // h-44

function PickerColumn({
  items,
  value,
  onChange,
}: {
  items: number[]
  value: number
  onChange: (v: number) => void
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const scrollingRef = React.useRef(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // pad = (CONTAINER_H - ITEM_H) / 2，首尾填塞使所有项都能滚到中央
  const [pad, setPad] = React.useState(70)

  // 测量实际 pad，因为 DOM 可能有误差
  React.useEffect(() => {
    if (containerRef.current) {
      const measured = (containerRef.current.clientHeight - ITEM_H) / 2
      if (Math.abs(measured - pad) > 1) setPad(measured)
    }
  })

  // 数学推导：scrollTop = val * ITEM_H / pad 在两侧抵消
  const scrollTo = React.useCallback((val: number) => {
    if (listRef.current) {
      listRef.current.scrollTop = val * ITEM_H
    }
  }, [])

  const calcCenter = React.useCallback(() => {
    if (!listRef.current) return
    const st = listRef.current.scrollTop
    const val = Math.round(st / ITEM_H)
    return Math.min(items.length - 1, Math.max(0, val))
  }, [items.length])

  // 初始居中
  React.useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollTo(value))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 外部 value 变化同步滚动
  const prevValue = React.useRef(value)
  React.useEffect(() => {
    if (prevValue.current !== value && !scrollingRef.current) {
      scrollTo(value)
    }
    prevValue.current = value
  }, [value, scrollTo])

  const snapToCenter = React.useCallback(() => {
    const clamped = calcCenter()
    if (clamped !== undefined) onChange(clamped)
  }, [calcCenter, onChange])

  const handleScroll = React.useCallback(() => {
    scrollingRef.current = true
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      scrollingRef.current = false
      snapToCenter()
    }, 150)
  }, [snapToCenter])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (listRef.current) {
      listRef.current.scrollTop += e.deltaY
      scrollingRef.current = true
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        scrollingRef.current = false
        snapToCenter()
      }, 150)
    }
  }

  const handleClick = (v: number) => {
    scrollTo(v)
    onChange(v)
  }

  return (
    <div ref={containerRef} className="relative shrink-0 overflow-hidden rounded-md" style={{ width: COL_W, height: CONTAINER_H }}>
      {/* 渐变遮罩 */}
      <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-background to-transparent pointer-events-none z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-b from-transparent to-background pointer-events-none z-10" />
      {/* 居中选择框 */}
      <div className="absolute top-1/2 left-1 right-1 h-9 -translate-y-1/2 pointer-events-none border-2 border-[#f97316] rounded-md z-0" />
      {/* 滚动列表 */}
      <div
        ref={listRef}
        className="w-full overflow-y-scroll no-scrollbar"
        style={{ height: CONTAINER_H }}
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        <div style={{ height: pad }} />
        {items.map((v) => (
          <div
            key={v}
            className="h-9 flex items-center justify-center text-sm text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors"
            onClick={() => handleClick(v)}
          >
            {String(v).padStart(2, '0')}
          </div>
        ))}
        <div style={{ height: pad }} />
      </div>
    </div>
  )
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

  React.useEffect(() => {
    if (value) {
      setInputValue(dayjs(value).format("YYYY-MM-DD HH:mm:ss"))
      setHour(dayjs(value).hour())
      setMinute(dayjs(value).minute())
      setSecond(dayjs(value).second())
    }
  }, [value])

  const emit = (h: number, m: number, s: number) => {
    const date = selectedDate || new Date()
    onChange(dayjs(date).hour(h).minute(m).second(s).format("YYYY-MM-DDTHH:mm:ss"))
  }

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      onChange(dayjs(date).hour(hour).minute(minute).second(second).format("YYYY-MM-DDTHH:mm:ss"))
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputBlur = () => {
    const parsed = dayjs(inputValue, "YYYY-MM-DD HH:mm:ss", true)
    if (parsed.isValid()) {
      setHour(parsed.hour())
      setMinute(parsed.minute())
      setSecond(parsed.second())
      onChange(parsed.format("YYYY-MM-DDTHH:mm:ss"))
    } else {
      setInputValue(value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleInputBlur()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          aria-label={placeholder || '日期时间'}
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
          <div className="flex items-center p-3 gap-1.5">
            <PickerColumn items={hours} value={hour} onChange={(v) => { setHour(v); emit(v, minute, second) }} />
            <span className="text-sm text-muted-foreground shrink-0 -mt-1">:</span>
            <PickerColumn items={minutes} value={minute} onChange={(v) => { setMinute(v); emit(hour, v, second) }} />
            <span className="text-sm text-muted-foreground shrink-0 -mt-1">:</span>
            <PickerColumn items={seconds} value={second} onChange={(v) => { setSecond(v); emit(hour, minute, v) }} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}