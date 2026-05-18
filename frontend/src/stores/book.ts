import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { bookApi, type BookItem } from '../api/book'

interface BookState {
  currentBookId: string | null
  books: BookItem[]
  booksLoaded: boolean

  setCurrentBook: (id: string | null) => void
  setBooks: (books: BookItem[]) => void
  addBook: (book: BookItem) => void
  removeBook: (id: string) => void
  fetchBooks: () => Promise<void>
}

export const useBookStore = create<BookState>()(
  persist(
    (set, get) => ({
      currentBookId: null,
      books: [],
      booksLoaded: false,

      setCurrentBook: (id) => set({ currentBookId: id }),

      setBooks: (books) => set({ books, booksLoaded: true }),

      addBook: (book) => set((state) => ({ books: [book, ...state.books] })),

      removeBook: (id) =>
        set((state) => ({
          books: state.books.filter((b) => b.id !== id),
          currentBookId: state.currentBookId === id ? null : state.currentBookId,
        })),

      fetchBooks: async () => {
        try {
          const books = await bookApi.listBooks()
          set({ books, booksLoaded: true })
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
          set({ booksLoaded: true })
        }
      },
    }),
    { name: 'book-storage' }
  )
)
