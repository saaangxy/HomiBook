import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { secureDelete, secureGet, secureSet } from './storage';

// HTTP 客户端:baseUrl 注入 + Bearer 凭据(JWT 与 API Key 同通道,后端自动识别)
// + 10s 超时 + 统一错误解析 + 全局 401 拦截
// + 原生 multipart 文件上传 / 附件下载(保存到本地分享面板)

const CREDENTIAL_KEY = 'homibook.credential';

/** 登录凭据:JWT(eyJ...) 或 API Key(homibook_...) */
export interface Credential {
  kind: 'jwt' | 'apikey';
  value: string;
  /** 过期时间(毫秒时间戳);缺省视为不过期(API Key 后端无过期) */
  expiresAt?: number;
}

/** 解码 JWT 的过期时间(Unix 秒) -> 毫秒时间戳;非合法 JWT 或缺少 exp 返回 null */
export function decodeJwtExp(token: string): number | null {
  try {
    // JWT 三段式:header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url -> base64,RN/Expo 全局自带 atob
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/** 凭据是否已过期(未设置 expiresAt 视为永不过期) */
export function isCredentialExpired(cred: Credential | null): boolean {
  if (!cred || cred.expiresAt == null) return false;
  return Date.now() >= cred.expiresAt;
}

export class ApiError extends Error {
  /** 0 = 网络/超时类错误 */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let currentBaseUrl = '';
let onUnauthorized: (() => void) | null = null;

export function setBaseUrl(url: string) {
  currentBaseUrl = url.replace(/\/+$/, '');
}

export function getBaseUrl() {
  return currentBaseUrl;
}

/** 注册全局 401 回调(清凭据 + 回登录页) */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function saveCredential(c: Credential): Promise<void> {
  await secureSet(CREDENTIAL_KEY, JSON.stringify(c));
}

export async function getCredential(): Promise<Credential | null> {
  try {
    const raw = await secureGet(CREDENTIAL_KEY);
    return raw ? (JSON.parse(raw) as Credential) : null;
  } catch {
    return null;
  }
}

export async function clearCredential(): Promise<void> {
  await secureDelete(CREDENTIAL_KEY);
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
}

/** 拼接 query 参数到 URL */
function buildQuery(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  const cred = await getCredential();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${currentBaseUrl}${buildQuery(path, opts?.query)}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cred ? { Authorization: `Bearer ${cred.value}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 401) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      if (cred) {
        // 携带凭据仍 401 → 会话已过期(凭据失效)
        onUnauthorized?.();
        throw new ApiError(401, '登录已过期,请重新登录');
      }
      // 无凭据(登录/注册等) → 返回后端具体错误(如"账号或密码错误")
      throw new ApiError(401, data?.message ?? '认证失败');
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(res.status, data?.message ?? `请求失败 (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new ApiError(0, '连接超时,请检查服务器地址');
    throw new ApiError(0, '无法连接服务器,请检查网络与地址');
  } finally {
    clearTimeout(timer);
  }
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};

// ── 文件上传/下载(原生实现,RN 新架构下 fetch+FormData+Blob 链路兼容性差,统一走原生通道) ──

function parseBodyLoose(body: string): Record<string, unknown> {
  try { return body ? JSON.parse(body) : {}; } catch { return {}; }
}

/** 原生 multipart 上传:原样传输文件字节;返回服务端 JSON */
export async function uploadFileNative<T>(url: string, fileUri: string, mimeType: string): Promise<T> {
  const cred = await getCredential();
  if (!url || !fileUri) throw new Error('缺少上传参数');
  if (!cred) throw new Error('请先配置服务器并登录');
  const res = await FileSystem.uploadAsync(url, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType,
    headers: { Authorization: `Bearer ${cred.value}` },
  });
  const data = parseBodyLoose(res.body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error((data as any).message || `上传失败(${res.status})`);
  }
  return data as T;
}

/** 相对附件路径转完整 URL(相对时拼 baseUrl,绝对原样返回) */
export function resolveRemoteUrl(url: string): string {
  return url.startsWith('http') ? url : `${currentBaseUrl}${url.startsWith('/') ? url : `/${url}`}`;
}

/** 下载附件到本地并通过系统分享面板保存(等价 web 端的「下载」按钮) */
export async function downloadAndShareAttachment(path: string, fileName: string): Promise<void> {
  const cred = await getCredential();
  if (!cred) throw new Error('请先配置服务器并登录');
  // 后端下载接口(GET /api/records/download?path=&name=),二进制流
  const qs = `path=${encodeURIComponent(path)}&name=${encodeURIComponent(fileName)}`;
  const url = `${currentBaseUrl}/api/records/download?${qs}`;
  const res = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${fileName}`, {
    headers: { Authorization: `Bearer ${cred.value}` },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`下载失败(${res.status})`);
  const ok = await Sharing.isAvailableAsync();
  if (!ok) throw new Error('当前环境不支持保存文件');
  await Sharing.shareAsync(res.uri, { mimeType: 'application/octet-stream', dialogTitle: fileName });
}
