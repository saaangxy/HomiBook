import { mockServers } from '@/mock/data';
import type { AuthState, Server } from '@/types';

// 登录态服务:当前为内存 mock,后续用 expo-secure-store 持久化 + 真实鉴权

let servers: Server[] = [...mockServers];
let currentServerId: string | null = null;
let auth: AuthState = { isLoggedIn: false, username: '', nickname: '', serverId: null, remember: true };

export function fetchServers(): Promise<Server[]> {
  return Promise.resolve(servers);
}

export function getCurrentServer(): Promise<Server | null> {
  return Promise.resolve(servers.find((s) => s.id === currentServerId) ?? null);
}

export function addServer(name: string, baseUrl: string): Promise<Server> {
  const s: Server = { id: `s${Date.now()}`, name, baseUrl };
  servers = [...servers, s];
  return Promise.resolve(s);
}

export function updateServer(id: string, name: string, baseUrl: string): Promise<Server> {
  servers = servers.map((s) => (s.id === id ? { ...s, name, baseUrl } : s));
  return Promise.resolve(servers.find((s) => s.id === id)!);
}

export function removeServer(id: string): Promise<void> {
  servers = servers.filter((s) => s.id !== id);
  if (currentServerId === id) currentServerId = null;
  return Promise.resolve();
}

export function switchServer(id: string): Promise<void> {
  currentServerId = id;
  return Promise.resolve();
}

export function getAuth(): Promise<AuthState> {
  return Promise.resolve({ ...auth });
}

export function login(username: string, nickname: string, serverId: string, remember: boolean): Promise<AuthState> {
  currentServerId = serverId;
  auth = { isLoggedIn: true, username, nickname, serverId, remember };
  return Promise.resolve({ ...auth });
}

export function logout(): Promise<void> {
  auth = { isLoggedIn: false, username: '', nickname: '', serverId: null, remember: true };
  return Promise.resolve();
}