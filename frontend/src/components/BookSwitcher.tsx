import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ChevronDown, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const { books, currentBookId, setCurrentBook, fetchBooks, booksLoaded } = useBookStore()
  const navigate = useNavigate()
  const currentBook = books.find((b) => b.id === currentBookId)

  useEffect(() => {
    if (!booksLoaded) {
      fetchBooks()
    }
  }, [booksLoaded, fetchBooks])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="border-border bg-card text-foreground text-sm font-medium px-3.5 py-2 h-auto rounded-lg hover:border-[#f97316] hover:text-foreground"
        >
          <BookOpen size={16} className="text-[#f97316]" />
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
                book.id === currentBookId ? 'text-[#f97316]' : 'text-foreground',
              )}
            >
              <BookOpen size={16} className="text-muted-foreground shrink-0" />
              <span className="flex-1">{book.name}</span>
              <span
                className={cn(
                  'shrink-0 text-[11px] px-2 py-0.5 rounded-full font-semibold',
                  book.role === 'owner'
                    ? 'bg-[#f97316]/15 text-[#f97316]'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {roleLabels[book.role] || book.role}
              </span>
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
