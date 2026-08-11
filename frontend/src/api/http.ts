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
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }
  return res.json()
}

async function uploadFile(url: string, file: File): Promise<{ id: string; url: string; fullUrl: string; originalFilename: string }> {
  const token = getToken()
  const formData = new FormData()
  formData.append('file', file)

  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { method: 'POST', headers, body: formData })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Upload failed' }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }
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
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Upload failed' }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }
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
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: '下载失败' }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }

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