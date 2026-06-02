import { useState, useEffect, useRef } from 'react'
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { budgetApi } from '@/api/budget'
import { recordApi } from '@/api/record'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  bookId: string
  placeholder?: string
  disabled?: boolean
  protectedTags?: string[]
}

export function TagCombobox({ value, onChange, bookId, placeholder = '选择或输入标签...', disabled, protectedTags = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [budgetTags, setBudgetTags] = useState<string[]>([])
  const [recordTags, setRecordTags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!bookId) return
    setLoading(true)
    setError('')
    Promise.all([
      budgetApi.getTags(bookId),
      recordApi.getTags(bookId),
    ])
      .then(([bTags, rTags]) => {
        setBudgetTags(bTags)
        setRecordTags(rTags)
      })
      .catch((e) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [bookId])

  const allTags = [...new Set([...budgetTags, ...recordTags])]

  const filtered = search.trim()
    ? allTags.filter((t) => t.toLowerCase().includes(search.toLowerCase()))
    : allTags

  // 分组：预算标签 vs 流水已有标签（去重）
  const budgetFiltered = filtered.filter((t) => budgetTags.includes(t) && !value.includes(t))
  const recordFiltered = filtered.filter((t) => !budgetTags.includes(t) && !value.includes(t))

  const isNewTag = search.trim() && !allTags.includes(search.trim()) && !value.includes(search.trim())

  const addTag = (tag: string) => {
    if (!value.includes(tag)) {
      onChange([...value, tag])
    }
    setSearch('')
    setOpen(false)
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  return (
    <div className="space-y-2">
      {/* 已选标签 */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => {
            const isProtected = protectedTags.includes(tag)
            return (
              <Badge
                key={tag}
                variant="secondary"
                className={cn('gap-1 pr-1', isProtected && 'bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20')}
              >
                {tag}
                {!isProtected && (
                  <button
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    onClick={() => removeTag(tag)}
                    disabled={disabled}
                  >
                    <X size={10} />
                  </button>
                )}
              </Badge>
            )
          })}
        </div>
      )}

      {/* 输入选择器 */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={disabled}
            className={cn('w-full justify-between bg-background border-border h-auto min-h-9')}
          >
            <span className="text-muted-foreground">{placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="搜索或输入新标签..."
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
                <CommandEmpty>{error}</CommandEmpty>
              )}
              {!loading && !error && (
                <>
                  <CommandEmpty>
                    {isNewTag ? (
                      <button
                        className="flex items-center gap-2 px-2 py-1.5 text-sm text-[#f97316] hover:bg-accent rounded-sm w-full cursor-pointer"
                        onClick={() => addTag(search.trim())}
                      >
                        <Plus className="h-4 w-4" />
                        创建 &ldquo;{search.trim()}&rdquo;
                      </button>
                    ) : (
                      '无匹配标签'
                    )}
                  </CommandEmpty>
                  {budgetFiltered.length > 0 && (
                    <CommandGroup heading="预算标签">
                      {budgetFiltered.map((tag) => (
                        <CommandItem
                          key={tag}
                          value={tag}
                          onSelect={() => addTag(tag)}
                        >
                          <Check className="h-4 w-4 opacity-0" />
                          {tag}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {recordFiltered.length > 0 && (
                    <CommandGroup heading="流水已有标签">
                      {recordFiltered.map((tag) => (
                        <CommandItem
                          key={tag}
                          value={tag}
                          onSelect={() => addTag(tag)}
                        >
                          <Check className="h-4 w-4 opacity-0" />
                          {tag}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
