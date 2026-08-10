import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useBookStore } from '../stores/book'
import { cn } from '@/lib/utils'

const roleLabels: Record<string, string> = {
  owner: '归属人',
  admin: '管理员',
  member: '成员',
}

export function BookSwitcher() {
  const { books, currentBookId, setCurrentBook, fetchBooks } = useBookStore()
  const navigate = useNavigate()
  const currentBook = books.find((b) => b.id === currentBookId)

  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="border-border bg-card text-foreground text-sm font-medium px-3.5 py-2 h-auto rounded-lg hover:border-primary hover:text-foreground"
        >
          <BookOpen size={16} className="text-primary" />
          <span className="ml-2">{currentBook ? currentBook.name : '选择账本'}</span>
          <ChevronDown size={14} className="ml-1 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[280px] bg-card border-border" align="end">
        {books.length === 0 ? (
          <div className="text-center py-5 text-[13px] text-muted-foreground">暂无账本</div>
        ) : (
          books.map((book) => (
            <DropdownMenuItem
              key={book.id}
              onClick={() => setCurrentBook(book.id)}
              className={cn(
                'py-2.5 px-3.5 cursor-pointer',
                book.id === currentBookId ? 'text-primary' : 'text-foreground',
              )}
            >
              <BookOpen size={16} className="text-muted-foreground shrink-0" />
              <span className="flex-1">{book.name}</span>
              <Badge
                variant={book.role === 'owner' ? 'default' : 'secondary'}
                className="shrink-0 text-[11px]"
              >
                {roleLabels[book.role] || book.role}
              </Badge>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate('/books')}
          className="text-sm text-muted-foreground py-2 px-3.5 cursor-pointer"
        >
          <BookOpen size={14} />
          管理账本
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
