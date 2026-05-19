import { useEffect } from 'react'
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection } from '@heroui/react'
import { BookOpen, ChevronDown, Users } from 'lucide-react'
import { useBookStore } from '../stores/book'

const roleLabels: Record<string, string> = {
  owner: '归属人',
  admin: '管理员',
  member: '成员',
}


export function BookSwitcher() {
  const { books, currentBookId, setCurrentBook, fetchBooks, booksLoaded } = useBookStore()

  const currentBook = books.find((b) => b.id === currentBookId)

  useEffect(() => {
    if (!booksLoaded) {
      fetchBooks()
    }
  }, [booksLoaded, fetchBooks])

  return (
    <Dropdown placement="bottom-end" classNames={{ content: 'bg-[#1e293b] border border-[#334155] rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] p-1 min-w-[280px]' }}>
      <DropdownTrigger>
        <Button
          variant="bordered"
          className="border-[#334155] bg-[#1e293b] text-[#e2e8f0] text-sm font-medium px-3.5 py-2 h-auto rounded-lg hover:border-[#f97316]"
        >
          <BookOpen size={16} className="text-[#f97316]" />
          <span className="ml-2">{currentBook ? currentBook.name : '选择账本'}</span>
          <ChevronDown size={14} className="ml-1 text-[#64748b]" />
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="账本列表"
        className="p-0"
        onAction={(key) => {
          if (key === 'manage') {
            // handled by click on the item
          } else {
            setCurrentBook(key as string)
          }
        }}
        emptyContent={<div className="text-center py-5 text-[13px] text-[#64748b]">暂无账本</div>}
        variant="flat"
        itemClasses={{
          base: 'data-[hover=true]:bg-white/5 rounded-lg',
        }}
      >
        <DropdownSection items={books} aria-label="我的账本" showDivider classNames={{ divider: 'bg-[#334155]' }}>
          {(book) => (
            <DropdownItem
              key={book.id}
              className={`py-2.5 px-3.5 ${book.id === currentBookId ? 'text-[#f97316]' : 'text-[#e2e8f0]'}`}
              description={
                <div className="flex items-center gap-1 text-xs text-[#64748b]">
                  <Users size={12} />
                  {book.memberCount}
                </div>
              }
              endContent={
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                    book.role === 'owner'
                      ? 'bg-[#f97316]/15 text-[#f97316]'
                      : 'bg-[#64748b]/15 text-[#94a3b8]'
                  }`}
                >
                  {roleLabels[book.role] || book.role}
                </span>
              }
              startContent={<BookOpen size={16} className="text-[#64748b]" />}
            >
              {book.name}
            </DropdownItem>
          )}
        </DropdownSection>
        <DropdownSection aria-label="操作">
          <DropdownItem
            key="manage"
            className="text-sm text-[#94a3b8] py-2 px-3.5 data-[hover=true]:bg-white/5 rounded-lg"
            startContent={<BookOpen size={14} />}
            href="/books"
          >
            管理账本
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  )
}
