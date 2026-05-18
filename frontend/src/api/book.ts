import { api } from './http'

export interface BookItem {
  id: string
  name: string
  ownerId: string
  role: 'owner' | 'admin' | 'member'
  memberCount: number
  createdAt: string
}

export interface BookDetail {
  id: string
  name: string
  ownerId: string
  createdAt: string
  updatedAt: string
  owner: { id: string; name: string | null; email: string }
  members: BookMember[]
  memberCount: number
}

export interface BookMember {
  id: string
  userId: string
  role: string
  joinedAt: string
  user: { id: string; name: string | null; email: string }
}

export interface ShareCode {
  id: string
  code: string
  expiresAt: string | null
  createdAt: string
  isExpired: boolean
}

export interface ShareCodeLookup {
  bookId: string
  bookName: string
  code: string
  expiresAt: string | null
}

export const bookApi = {
  listBooks: () =>
    api.get<BookItem[]>('/api/books'),

  createBook: (name: string) =>
    api.post<BookItem>('/api/books', { name }),

  getBook: (id: string) =>
    api.get<BookDetail>(`/api/books/${id}`),

  updateBook: (id: string, data: { name?: string }) =>
    api.patch<BookItem>(`/api/books/${id}`, data),

  deleteBook: (id: string) =>
    api.delete(`/api/books/${id}`),

  listMembers: (bookId: string) =>
    api.get<BookMember[]>(`/api/books/${bookId}/members`),

  addMember: (bookId: string, email: string) =>
    api.post<BookMember>(`/api/books/${bookId}/members`, { email }),

  removeMember: (bookId: string, memberId: string) =>
    api.delete(`/api/books/${bookId}/members/${memberId}`),

  updateMemberRole: (bookId: string, memberId: string, role: string) =>
    api.patch<{ id: string; userId: string; role: string; joinedAt: string; user: { id: string; name: string | null; email: string } }>(
      `/api/books/${bookId}/members/${memberId}/role`,
      { role }
    ),

  generateShareCode: (bookId: string, expiresInHours?: number) =>
    api.post<ShareCode>(`/api/books/${bookId}/share-codes`, { expiresInHours }),

  listShareCodes: (bookId: string) =>
    api.get<ShareCode[]>(`/api/books/${bookId}/share-codes`),

  deleteShareCode: (bookId: string, codeId: string) =>
    api.delete(`/api/books/${bookId}/share-codes/${codeId}`),

  lookupCode: (code: string) =>
    api.get<ShareCodeLookup>(`/api/books/share-codes/${code}`),

  joinByCode: (code: string) =>
    api.post<BookItem>('/api/books/join', { code }),
}
