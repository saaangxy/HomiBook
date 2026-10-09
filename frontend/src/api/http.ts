// ---- 401 拦截 ----

/**
 * 凭据失效(401)时的处理器,**由应用入口注入**(见 main.tsx)。
 * 本文件不直接 import store:`stores/chat → api/chat → api/http`,反向依赖会成环。
 */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  onUnauthorized = handler
}

/**
 * 记录已处理过的失效凭据。并发请求用的是同一个 token,会同时收到 401,
 * 靠它保证只清理/跳转一次;重新登录后 token 变了,自然能再次触发。
 */
let handledToken: string | null = null

/** 登录/注册接口的 401 表示「账号密码错误」,不是凭据失效,不能把人踢去登录页 */
const AUTH_ENDPOINTS = ['/api/auth/login', '/api/auth/register']

/**
 * 401 统一处理。只有**带了 token** 的请求才算「登录态失效」;
 * SSE 等自持 fetch 的调用方也复用这套判定。
 */
export function notifyUnauthorized(status: number, token: string | null, url?: string) {
  if (status !== 401 || !token) return
  if (url && AUTH_ENDPOINTS.some((p) => url.includes(p))) return
  if (handledToken === token) return
  handledToken = token
  onUnauthorized?.()
}

/** 把失败响应统一转成 Error,并顺带处理 401 */
async function toError(res: Response, token: string | null, fallback: string, url?: string): Promise<Error> {
  notifyUnauthorized(res.status, token, url)
  const error = await res.json().catch(() => ({ message: fallback }))
  return new Error(error.message || `HTTP ${res.status}`)
}

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.state?.token || null
  } catch {
    return null
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...options.headers as Record<string, string>,
  }
  // 有 body 时才设置 Content-Type，避免 DELETE 等无 body 请求被 Fastify 拒绝
  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, { ...options, headers })
  if (!res.ok) throw await toError(res, token, 'Request failed', url)
  return res.json()
}

async function uploadFile(url: string, file: File): Promise<{ id: string; url: string; fullUrl: string; originalFilename: string }> {
  const token = getToken()
  const formData = new FormData()
  formData.append('file', file)

  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { method: 'POST', headers, body: formData })
  if (!res.ok) throw await toError(res, token, 'Upload failed', url)
  return res.json()
}

async function uploadForm<T = any>(url: string, file: File, extraFields: Record<string, string>): Promise<T> {
  const token = getToken()
  const formData = new FormData()
  formData.append('file', file)
  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value)
  }
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { method: 'POST', headers, body: formData })
  if (!res.ok) throw await toError(res, token, 'Upload failed', url)
  return res.json()
}

/** 从 Content-Disposition 头解析文件名（下载备份 zip 用） */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const m = header.match(/filename="?([^";]+)"?/)
  return m ? m[1] : null
}

/** POST 下载：请求返回二进制 blob，触发浏览器保存文件。返回 X-Export-Counts header（如有） */
async function download(url: string, data?: unknown): Promise<Record<string, number> | null> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (data) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { method: 'POST', headers, body: data ? JSON.stringify(data) : undefined })
  if (!res.ok) throw await toError(res, token, '下载失败', url)

  // 读取各表导出数量（后端通过 X-Export-Counts header 返回）
  const countsHeader = res.headers.get('X-Export-Counts')
  const counts = countsHeader ? JSON.parse(countsHeader) as Record<string, number> : null

  const blob = await res.blob()
  const filename = filenameFromDisposition(res.headers.get('content-disposition')) || 'download.zip'
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)

  return counts
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, data: unknown) => request<T>(url, { method: 'POST', body: JSON.stringify(data) }),
  put: <T>(url: string, data: unknown) => request<T>(url, { method: 'PUT', body: JSON.stringify(data) }),
  patch: <T>(url: string, data: unknown) => request<T>(url, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(url: string, data?: unknown) => request<T>(url, { method: 'DELETE', body: data ? JSON.stringify(data) : undefined }),
  uploadFile,
  uploadForm,
  download,
}