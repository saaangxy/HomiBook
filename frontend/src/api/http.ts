import ky from 'ky'

const api = ky.create({
  prefixUrl: 'http://10.144.213.13:3001/api',
  hooks: {
    beforeRequest: (request) => {
      const token = localStorage.getItem('token')
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`)
      }
    },
  },
})

export const http = {
  get: <T>(url: string) => api.get(url).json<T>(),
  post: <T>(url: string, json: unknown) => api.post(url, { json }).json<T>(),
  put: <T>(url: string, json: unknown) => api.put(url, { json }).json<T>(),
  delete: <T>(url: string) => api.delete(url).json<T>(),
}