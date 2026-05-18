import { useState, useEffect, useRef } from 'react'
import { useBookStore } from '../stores/book'
import { ChevronDown, BookOpen, Users } from 'lucide-react'
import type React from 'react'

const s = {
  wrapper: {
    position: 'relative' as const,
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#1e293b',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    transition: 'border-color 0.2s',
    whiteSpace: 'nowrap' as const,
  },
  triggerIcon: {
    width: 16,
    height: 16,
    color: '#f97316',
  },
  chevron: {
    width: 14,
    height: 14,
    color: '#64748b',
    transition: 'transform 0.2s',
  },
  dropdown: {
    position: 'absolute' as const,
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: 280,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
    zIndex: 100,
    overflow: 'hidden',
    padding: 4,
  },
  listItem: (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    background: active ? 'rgba(249,115,22,0.1)' : 'transparent',
    color: active ? '#f97316' : '#e2e8f0',
    transition: 'background 0.15s',
    gap: 12,
  }),
  listItemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
    flex: 1,
  },
  listItemIcon: {
    width: 16,
    height: 16,
    color: '#64748b',
    flexShrink: 0,
  },
  bookName: {
    fontSize: 14,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  badge: (role: string) => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 600,
    background: role === 'owner' ? 'rgba(249,115,22,0.15)' : 'rgba(100,116,139,0.15)',
    color: role === 'owner' ? '#f97316' : '#94a3b8',
  }),
  memberCount: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: '#64748b',
  },
  divider: {
    height: 1,
    background: '#334155',
    margin: '4px 0',
  },
  footerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    color: '#94a3b8',
    fontSize: 13,
    transition: 'background 0.15s',
  },
  empty: {
    padding: '20px 14px',
    textAlign: 'center' as const,
    color: '#64748b',
    fontSize: 13,
  },
}

const roleLabels: Record<string, string> = {
  owner: '归属人',
  admin: '管理员',
  member: '成员',
}

export function BookSwitcher() {
  const [open, setOpen] = useState(false)
  const { books, currentBookId, setCurrentBook, fetchBooks, booksLoaded } = useBookStore()
  const wrapperRef = useRef<HTMLDivElement>(null)

  const currentBook = books.find((b) => b.id === currentBookId)

  useEffect(() => {
    if (!booksLoaded) {
      fetchBooks()
    }
  }, [booksLoaded, fetchBooks])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (id: string) => {
    setCurrentBook(id)
    setOpen(false)
  }

  return (
    <div style={s.wrapper} ref={wrapperRef}>
      <button
        style={s.trigger}
        onClick={() => setOpen(!open)}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = '#f97316'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = '#334155'
        }}
      >
        <BookOpen style={s.triggerIcon} />
        <span>{currentBook ? currentBook.name : '选择账本'}</span>
        <ChevronDown
          style={{
            ...s.chevron,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {open && (
        <div style={s.dropdown}>
          {books.length === 0 ? (
            <div style={s.empty}>暂无账本</div>
          ) : (
            books.map((book) => (
              <div
                key={book.id}
                style={s.listItem(book.id === currentBookId)}
                onClick={() => handleSelect(book.id)}
                onMouseEnter={(e) => {
                  if (book.id !== currentBookId) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (book.id !== currentBookId) {
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                <div style={s.listItemLeft}>
                  <BookOpen style={s.listItemIcon} />
                  <span style={s.bookName}>{book.name}</span>
                </div>
                <div style={s.memberCount}>
                  <Users style={{ width: 12, height: 12 }} />
                  <span>{book.memberCount}</span>
                </div>
                <span style={s.badge(book.role)}>{roleLabels[book.role] || book.role}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
