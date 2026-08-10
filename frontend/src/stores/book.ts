import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { bookApi, type BookItem } from '../api/book'

interface BookState {
  currentBookId: string | null
  books: BookItem[]

  setCurrentBook: (id: string | null) => void
  setBooks: (books: BookItem[]) => void
  addBook: (book: BookItem) => void
  removeBook: (id: string) => void
  fetchBooks: () => Promise<void>
}

// 并发去重：MainLayout 与 BookSwitcher 挂载时会同时请求，避免重复拉取
let fetchInflight: Promise<void> | null = null

export const useBookStore = create<BookState>()(
  persist(
    (set, get) => ({
      currentBookId: null,
      books: [],

      setCurrentBook: (id) => set({ currentBookId: id }),

      setBooks: (books) => set({ books }),

      addBook: (book) => set((state) => ({ books: [book, ...state.books] })),

      removeBook: (id) =>
        set((state) => ({
          books: state.books.filter((b) => b.id !== id),
          currentBookId: state.currentBookId === id ? null : state.currentBookId,
        })),

      // 每次进入应用都重新拉取账本，保证切换数据库/刷新后列表是最新的
      fetchBooks: async () => {
        if (fetchInflight) return fetchInflight
        fetchInflight = (async () => {
          try {
            const books = await bookApi.listBooks()
            set({ books })
            // 如果当前选中的账本不在列表中，清除选择
            const { currentBookId } = get()
            if (currentBookId && !books.find((b) => b.id === currentBookId)) {
              set({ currentBookId: books.length > 0 ? books[0].id : null })
            }
            // 如果有账本但没有选中，自动选第一个
            if (!get().currentBookId && books.length > 0) {
              set({ currentBookId: books[0].id })
            }
          } catch {
            // 失败时保持现有列表，不抛错打断页面
          } finally {
            fetchInflight = null
          }
        })()
        return fetchInflight
      },
    }),
    {
      name: 'book-storage',
      // 只持久化账本与当前选中项，便于刷新后先展示缓存、随后被最新数据覆盖
      partialize: (state) => ({
        books: state.books,
        currentBookId: state.currentBookId,
      }),
    }
  )
)
