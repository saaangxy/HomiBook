import { useState } from 'react'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface MultiSelectItem {
  value: string
  label: string
}

interface MultiSelectProps {
  items: MultiSelectItem[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function MultiSelect({
  items,
  selected,
  onChange,
  placeholder = '请选择...',
  disabled,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = items.filter((item) => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return item.label.toLowerCase().includes(s)
  })

  const allSelected = filtered.length > 0 && filtered.every((item) => selected.includes(item.value))
  const noneSelected = selected.length === 0

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const toggleAll = () => {
    if (allSelected) {
      const filteredValues = new Set(filtered.map((item) => item.value))
      onChange(selected.filter((v) => !filteredValues.has(v)))
    } else {
      const toAdd = filtered.filter((item) => !selected.includes(item.value)).map((item) => item.value)
      onChange([...selected, ...toAdd])
    }
  }

  const selectedLabels = items
    .filter((item) => selected.includes(item.value))
    .map((item) => item.label)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn(
            'w-full justify-between bg-background border-border h-auto min-h-9',
            noneSelected && 'text-muted-foreground',
            className,
          )}
        >
          {noneSelected ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="truncate text-left">
              {selectedLabels.length <= 2
                ? selectedLabels.join(', ')
                : `${selectedLabels.length} 项已选`}
            </span>
          )}
          {!noneSelected && (
            <span
              className="ml-1 h-4 w-4 shrink-0 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); onChange([]) }}
            >
              <X size={14} />
            </span>
          )}
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="flex flex-col">
          {/* 搜索框 */}
          <div className="flex items-center border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 opacity-50 mr-2" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* 全选 */}
          {filtered.length > 0 && (
            <button
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent cursor-pointer border-b"
              onClick={toggleAll}
            >
              <span className={cn(
                'flex h-4 w-4 items-center justify-center rounded border border-border',
                allSelected && 'bg-primary border-primary',
              )}>
                {allSelected && <Check className="h-3 w-3 text-white" />}
              </span>
              {allSelected ? '取消全选' : '全选'}
            </button>
          )}
          {/* 选项列表（onWheel 阻止事件冒泡到 document，避免 react-remove-scroll 拦截） */}
          <div className="max-h-48 overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
            {filtered.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">无匹配选项</div>
            ) : (
              filtered.map((item) => {
                const isSelected = selected.includes(item.value)
                return (
                  <button
                    key={item.value}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer text-left',
                      isSelected && 'text-foreground',
                    )}
                    onClick={() => toggle(item.value)}
                  >
                    <span className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border',
                      isSelected && 'bg-primary border-primary',
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </span>
                    {item.label}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
