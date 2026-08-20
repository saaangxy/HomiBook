import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCredential, http, saveCredential, setBaseUrl } from './http';
import { secureDelete, secureGet, secureSet } from './storage';
import type { Server, UserInfo } from '@/types';

// 认证与服务器管理服务:
// - 服务器列表持久化 AsyncStorage(非敏感)
// - 登录凭据(JWT/API Key)由 services/http 经 expo-secure-store 保管
// - 「记住我」的账号密码存 SecureStore(仅勾选时)

// 认证模式开关:
// - 'mock':本地模拟登录,不请求后端(当前默认,页面照常可用,任意账号密码放行)
// - 'real':对接真实后端(POST /api/auth/login + GET /api/auth/me,签名已对齐)
// M5 联调时把此值改为 'real' 即可,页面层零改动
export const AUTH_MODE: 'mock' | 'real' = 'mock';

// mock 模式用户:theme 用非法值 'default',避免登录时把本机主题选择覆盖掉
const MOCK_USER: UserInfo = {
  id: 'u-mock',
  email: 'demo@homibook.app',
  username: 'demo',
  nickname: '演示用户',
  role: 'USER',
  theme: 'default',
};

const MOCK_CREDENTIAL = { kind: 'jwt' as const, value: 'mock-token' };

const SERVERS_KEY = 'homibook.servers';
const REMEMBER_KEY = 'homibook.remember';

interface ServersData {
  list: Server[];
  currentId: string | null;
}

async function readServers(): Promise<ServersData> {
  try {
    const raw = await AsyncStorage.getItem(SERVERS_KEY);
    if (raw) return JSON.parse(raw) as ServersData;
  } catch {}
  return { list: [], currentId: null };
}

async function writeServers(data: ServersData): Promise<void> {
  await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(data)).catch(() => {});
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

export async function addServer(name: string, baseUrl: string, account?: string): Promise<Server> {
  const d = await readServers();
  const s: Server = { id: `s${Date.now()}`, name, baseUrl: baseUrl.replace(/\/+$/, ''), account: account || undefined };
  // 首个服务器自动设为当前
  await writeServers({ list: [...d.list, s], currentId: d.currentId ?? s.id });
  return s;
}

export async function updateServer(id: string, name: string, baseUrl: string, account?: string): Promise<Server> {
  const d = await readServers();
  const list = d.list.map((s) => (s.id === id ? { ...s, name, baseUrl: baseUrl.replace(/\/+$/, ''), account: account || s.account } : s));
  await writeServers({ ...d, list });
  return list.find((s) => s.id === id)!;
}

/** 绑定账号到服务器(登录成功后调用) */
export async function bindServerAccount(id: string, account: string): Promise<void> {
  const d = await readServers();
  const list = d.list.map((s) => (s.id === id ? { ...s, account } : s));
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
  if (AUTH_MODE === 'mock') {
    // mock:任意账号密码放行,用户名取输入值;保存 mock 凭据以便重启后恢复会话
    await saveCredential(MOCK_CREDENTIAL);
    return { ...MOCK_USER, username: account, nickname: account };
  }
  const res = await http.post<{ token: string; user: UserInfo }>('/api/auth/login', { account, password });
  await saveCredential({ kind: 'jwt', value: res.token });
  return res.user;
}

/** API Key 登录:先存临时凭据再调 me 验证,失败即清除 */
export async function verifyApiKey(key: string): Promise<UserInfo> {
  if (AUTH_MODE === 'mock') {
    await saveCredential(MOCK_CREDENTIAL);
    return { ...MOCK_USER };
  }
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
  if (AUTH_MODE === 'mock') {
    return { ...MOCK_USER };
  }
  return http.get<UserInfo>('/api/auth/me');
}

export async function apiLogout(): Promise<void> {
  await clearCredential();
}

// ==================== 记住我 ====================

export async function saveRemembered(account: string, password: string): Promise<void> {
  await secureSet(REMEMBER_KEY, JSON.stringify({ account, password }));
}

export async function getRemembered(): Promise<{ account: string; password: string } | null> {
  try {
    const raw = await secureGet(REMEMBER_KEY);
    return raw ? (JSON.parse(raw) as { account: string; password: string }) : null;
  } catch {
    return null;
  }
}

export async function clearRemembered(): Promise<void> {
  await secureDelete(REMEMBER_KEY);
}
