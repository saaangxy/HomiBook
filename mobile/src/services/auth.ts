import { clearCredential, decodeJwtExp, http, saveCredential, setBaseUrl } from './http';
import { secureGet, secureSet } from './storage';
import type { Server, UserInfo } from '@/types';

// 认证与服务器管理服务:
// - 服务器配置(名称/地址/账号/密码/API Key)一体管理,整体存 SecureStore(敏感信息加密)
// - 登录凭据(JWT/API Key)由 services/http 经 expo-secure-store 保管
// - 账号密码并入服务器配置,不再单独用全局「记住我」分开管理

const SERVERS_KEY = 'homibook.servers';

interface ServersData {
  list: Server[];
  currentId: string | null;
}

async function readServers(): Promise<ServersData> {
  try {
    const raw = await secureGet(SERVERS_KEY);
    if (raw) return JSON.parse(raw) as ServersData;
  } catch {}
  return { list: [], currentId: null };
}

async function writeServers(data: ServersData): Promise<void> {
  await secureSet(SERVERS_KEY, JSON.stringify(data));
  const cur = data.list.find((s) => s.id === data.currentId);
  setBaseUrl(cur?.baseUrl ?? '');
}

// ==================== 服务器管理 ====================

export async function fetchServers(): Promise<Server[]> {
  return (await readServers()).list;
}

export async function getCurrentServer(): Promise<Server | null> {
  const d = await readServers();
  const cur = d.list.find((s) => s.id === d.currentId) ?? null;
  setBaseUrl(cur?.baseUrl ?? '');
  return cur;
}

export interface ServerCredential {
  account?: string;
  password?: string;
  apiKey?: string;
}

export async function addServer(name: string, baseUrl: string, cred: ServerCredential = {}): Promise<Server> {
  const d = await readServers();
  const s: Server = {
    id: `s${Date.now()}`,
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    account: cred.account || undefined,
    password: cred.password || undefined,
    apiKey: cred.apiKey || undefined,
  };
  // 首个服务器自动设为当前
  await writeServers({ list: [...d.list, s], currentId: d.currentId ?? s.id });
  return s;
}

export async function updateServer(id: string, name: string, baseUrl: string, cred: ServerCredential = {}): Promise<Server> {
  const d = await readServers();
  const list = d.list.map((s) =>
    s.id === id
      ? {
          ...s,
          name,
          baseUrl: baseUrl.replace(/\/+$/, ''),
          account: cred.account || s.account,
          password: cred.password !== undefined ? cred.password : s.password,
          apiKey: cred.apiKey !== undefined ? cred.apiKey : s.apiKey,
        }
      : s,
  );
  await writeServers({ ...d, list });
  return list.find((s) => s.id === id)!;
}

/** 登录成功后把凭证写回服务器配置(账号/密码/API Key 一体保存) */
export async function bindServerCredential(id: string, cred: ServerCredential): Promise<void> {
  const d = await readServers();
  const list = d.list.map((s) =>
    s.id === id
      ? {
          ...s,
          account: cred.account || s.account,
          password: cred.password !== undefined ? cred.password : s.password,
          apiKey: cred.apiKey !== undefined ? cred.apiKey : s.apiKey,
        }
      : s,
  );
  await writeServers({ ...d, list });
}

export async function removeServer(id: string): Promise<void> {
  const d = await readServers();
  await writeServers({
    list: d.list.filter((s) => s.id !== id),
    currentId: d.currentId === id ? null : d.currentId,
  });
}

export async function switchServer(id: string): Promise<void> {
  const d = await readServers();
  await writeServers({ ...d, currentId: id });
}

// ==================== 会话 ====================

/** 密码登录:成功保存 JWT 凭据 */
export async function apiLogin(account: string, password: string): Promise<UserInfo> {
  const res = await http.post<{ token: string; user: UserInfo }>('/api/auth/login', { account, password });
  // JWT 的 exp 存在 token 里,解码后写入凭据用于本地过期判断
  await saveCredential({ kind: 'jwt', value: res.token, expiresAt: decodeJwtExp(res.token) ?? undefined });
  return res.user;
}

/** API Key 登录:先存临时凭据再调 me 验证,失败即清除 */
export async function verifyApiKey(key: string): Promise<UserInfo> {
  // API Key 后端无过期时间(永久有效,直到删除),不设 expiresAt 视为永不过期
  await saveCredential({ kind: 'apikey', value: key });
  try {
    return await http.get<UserInfo>('/api/auth/me');
  } catch (e) {
    await clearCredential();
    throw e;
  }
}

/** 拉取当前用户(启动会话恢复/主题同步) */
export async function apiMe(): Promise<UserInfo> {
  return http.get<UserInfo>('/api/auth/me');
}

/** 上传主题偏好到账号(与网页端共享 user.theme;失败由调用方静默处理) */
export async function apiUpdateTheme(theme: string): Promise<UserInfo> {
  return http.patch<UserInfo>('/api/auth/me', { theme });
}

export async function apiLogout(): Promise<void> {
  await clearCredential();
}
