import { secureDelete, secureGet, secureSet } from './storage';

// HTTP 客户端:baseUrl 注入 + Bearer 凭据(JWT 与 API Key 同通道,后端自动识别)
// + 10s 超时 + 统一错误解析 + 全局 401 拦截

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cred = await getCredential();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${currentBaseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cred ? { Authorization: `Bearer ${cred.value}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 401) {
      onUnauthorized?.();
      throw new ApiError(401, '登录已过期,请重新登录');
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
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
