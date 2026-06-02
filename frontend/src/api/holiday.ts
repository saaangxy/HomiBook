import { api } from './http'

export interface HolidayItem {
  id: string
  date: string
  name: string
  isWorkday: boolean
}

export const holidayApi = {
  getByYear: (year: number) =>
    api.get<HolidayItem[]>('/api/holidays?' + new URLSearchParams({ year: String(year) }).toString()),

  sync: () =>
    api.post<{ imported: number }>('/api/holidays/sync', {}),
}
