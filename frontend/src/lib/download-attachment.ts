import { notifyUnauthorized } from '@/api/http'

/** 从 localStorage 读当前登录 token（下载走原生 fetch，绕不开 api 客户端） */
function authToken(): string | null {
  try {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return null
    return JSON.parse(raw)?.state?.token || null
  } catch {
    return null
  }
}

/**
 * 下载附件：把 /api/uploads/... 的展示 URL 换成带鉴权的下载接口，
 * fetch 成 blob 后由临时 <a> 触发保存。
 *
 * 用原生 fetch 而不是 api 客户端：下载需要拿 blob 而不是 JSON。
 * 401 交给 notifyUnauthorized 统一处理，其余错误直接抛出，由调用方决定提示方式。
 */
export async function downloadAttachment(url: string, filename: string): Promise<void> {
  const relativePath = url.includes('/api/uploads/')
    ? `/api/uploads/${url.split('/api/uploads/').pop()}`
    : url
  const downloadUrl = `/api/records/download?path=${encodeURIComponent(relativePath)}&name=${encodeURIComponent(filename)}`

  const token = authToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(downloadUrl, { headers })
  if (!res.ok) {
    // 附件下载自持 fetch（需要 blob），401 同样上报给上层统一处理
    notifyUnauthorized(res.status, token, downloadUrl)
    throw new Error('下载失败')
  }

  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}
