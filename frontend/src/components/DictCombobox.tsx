import { useState, useEffect, useRef } from 'react'
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { settingsApi, type DictItem } from '@/api/settings'

interface Props {
  group?: string
  groups?: string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  valueKey?: 'code' | 'label'
}

export function DictCombobox({ group, groups, value, onChange, placeholder = '选择或输入...', disabled, valueKey = 'code' }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<DictItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const creatingRef = useRef(false)

  // 支持单 group 或多 groups 加载
  const groupList = groups ?? (group ? [group] : [])
  const groupKey = groups ? groups.join(',') : group ?? ''

  useEffect(() => {
    if (groupList.length === 0) return
    setLoading(true)
    setError('')
    Promise.all(groupList.map((g) => settingsApi.getDictionary(g)))
      .then((results) => {
        // 合并所有分组，去重（按 code）
        const merged: DictItem[] = []
        const seen = new Set<string>()
        for (const arr of results) {
          for (const item of arr) {
            if (!seen.has(item.code)) {
              seen.add(item.code)
              merged.push(item)
            }
          }
        }
        setItems(merged)
      })
      .catch((e) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [groupKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const getItemValue = (item: DictItem) => item[valueKey]
  const selectedLabel = items.length > 0
    ? items.find((item) => getItemValue(item) === value)?.label
    : undefined
  const handleCreate = async () => {
    if (creatingRef.current) return
    const createGroup = group || groups?.[0]
    if (!createGroup) return
    creatingRef.current = true
    try {
      const newItem = await settingsApi.createDictionaryItem({
        group: createGroup,
        code: search.trim(),
        label: search.trim(),
      })
      setItems((prev) => [...prev, newItem])
      onChange(getItemValue(newItem))
      setSearch('')
      setOpen(false)
    } catch {
      // 可能已存在，尝试选中匹配项
      const match = items.find((i) => i.code === search.trim() || i.label === search.trim())
      if (match) {
        onChange(getItemValue(match))
        setSearch('')
        setOpen(false)
      }
    } finally {
      creatingRef.current = false
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn(
            'w-full justify-between bg-background border-border',
            !value && 'text-muted-foreground',
          )}
        >
          {value ? (selectedLabel ?? placeholder) : placeholder}
          {value && (
            <span
              className="ml-auto h-4 w-4 shrink-0 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); onChange('') }}
            >
              <X size={14} />
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="搜索..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading && (
              <div className="py-6 flex justify-center">
                <Spinner />
              </div>
            )}
            {error && (
              <CommandEmpty>{error || '加载失败，请重试'}</CommandEmpty>
            )}
            {!loading && !error && (
              <>
                <CommandEmpty>
                  {search.trim() ? (
                    <button
                      className="flex items-center gap-2 px-2 py-1.5 text-sm text-primary hover:bg-accent rounded-sm w-full cursor-pointer"
                      onClick={handleCreate}
                    >
                      <Plus className="h-4 w-4" />
                      创建 &ldquo;{search.trim()}&rdquo;
                    </button>
                  ) : (
                    '无选项'
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {items
                    .filter((item) => {
                      if (!search.trim()) return true
                      const s = search.toLowerCase()
                      return item.label.toLowerCase().includes(s) || item.code.toLowerCase().includes(s)
                    })
                    .map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.code}
                        onSelect={() => {
                          onChange(getItemValue(item))
                          setSearch('')
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            'h-4 w-4',
                            value === getItemValue(item) ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        {item.label}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
