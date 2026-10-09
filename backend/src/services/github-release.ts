import { APP_VERSION } from '../version.js'

/**
 * 比对 GitHub Release 判断是否有新版本。
 *
 * 为什么由服务端代理,而不是 web / 移动端各自直连:
 *   - 浏览器直连 api.github.com 受 CORS 与「未认证 60 次/小时/IP」限流影响;
 *   - 移动端用户的网络未必能直连 GitHub,而后端通常有更稳定的出网线路;
 *   - 可在服务端缓存,避免每次点「检查更新」都打一次 GitHub。
 */

const REPO = 'saaangxy/HomiBook'
/** 成功结果的缓存时长:GitHub 未认证配额是 60 次/小时/IP,10 分钟一次足够 */
const CACHE_TTL_MS = 10 * 60 * 1000
/** 失败结果的缓存时长:短一些,让用户重试时还有机会打通 */
const ERROR_CACHE_TTL_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 8000

export interface LatestReleaseInfo {
  /** 当前服务端版本(与仓库发布版本同源:backend/package.json) */
  current: string
  /** GitHub 最新 Release 的版本号(已去掉 v 前缀);查询失败为 null */
  latest: string | null
  hasUpdate: boolean
  /** Release 页面地址 */
  releaseUrl: string | null
  publishedAt: string | null
  releaseName: string | null
  /** 查询失败的原因(供界面提示);成功为 null */
  error: string | null
}

interface CacheEntry {
  at: number
  ttl: number
  value: LatestReleaseInfo
}

let cache: CacheEntry | null = null

/** 去掉 v/V 前缀,便于比较与展示 */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

/**
 * 语义化比较:a > b 返回正数,a < b 返回负数,相等返回 0。
 * 只逐段比较数字(1.2.3 / v1.2.3 均可);多余的段按 0 处理,足够本场景使用。
 */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.')
  const pb = normalizeVersion(b).split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? '0', 10) || 0
    const nb = Number.parseInt(pb[i] ?? '0', 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

function remember(value: LatestReleaseInfo, ttl: number): LatestReleaseInfo {
  cache = { at: Date.now(), ttl, value }
  return value
}

/**
 * 查询 GitHub 最新 Release。
 * 网络不通 / 仓库无 Release / 被限流都**不抛错**,而是把原因写进 `error` ——
 * 界面只需提示「检查失败」,不该让整个请求变成错误。
 */
export async function checkLatestRelease(): Promise<LatestReleaseInfo> {
  const current = normalizeVersion(APP_VERSION)
  if (cache && Date.now() - cache.at < cache.ttl) return cache.value

  const base: LatestReleaseInfo = {
    current,
    latest: null,
    hasUpdate: false,
    releaseUrl: null,
    publishedAt: null,
    releaseName: null,
    error: null,
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'HomiBook',
    }
    // 配了 token 可提高配额(也支持私有仓库)
    const token = process.env.GITHUB_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const error = res.status === 404 ? '仓库暂无 Release' : `GitHub 返回 HTTP ${res.status}`
      return remember({ ...base, error }, ERROR_CACHE_TTL_MS)
    }

    const data = (await res.json()) as {
      tag_name?: string
      name?: string
      html_url?: string
      published_at?: string
    }
    const latest = normalizeVersion(data.tag_name ?? '')
    if (!latest) return remember({ ...base, error: 'GitHub Release 缺少版本号' }, ERROR_CACHE_TTL_MS)

    return remember(
      {
        ...base,
        latest,
        // 只有远端更高才算「有新版本」:本地比远端新(开发分支)不提示更新
        hasUpdate: compareVersions(latest, current) > 0,
        releaseUrl: data.html_url ?? null,
        publishedAt: data.published_at ?? null,
        releaseName: data.name ?? null,
      },
      CACHE_TTL_MS,
    )
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return remember({ ...base, error: timedOut ? '连接 GitHub 超时' : '无法连接 GitHub' }, ERROR_CACHE_TTL_MS)
  }
}
