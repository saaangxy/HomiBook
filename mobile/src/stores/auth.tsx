import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as authService from '@/services/auth';
import type { Server } from '@/types';

interface AuthStore {
  isLoggedIn: boolean;
  nickname: string;
  username: string;
  currentServer: Server | null;
  servers: Server[];
  login: (username: string, password: string, serverId: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  switchServer: (id: string) => Promise<void>;
  addServer: (name: string, baseUrl: string) => Promise<void>;
  updateServer: (id: string, name: string, baseUrl: string) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  refreshServers: () => Promise<void>;
}

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [nickname, setNickname] = useState('');
  const [username, setUsername] = useState('');
  const [currentServer, setCurrentServer] = useState<Server | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [ready, setReady] = useState(false);

  const refreshServers = useCallback(async () => {
    const [list, cur] = await Promise.all([authService.fetchServers(), authService.getCurrentServer()]);
    setServers(list);
    setCurrentServer(cur);
  }, []);

  useEffect(() => {
    (async () => {
      const auth = await authService.getAuth();
      setIsLoggedIn(auth.isLoggedIn);
      setNickname(auth.nickname);
      setUsername(auth.username);
      await refreshServers();
      setReady(true);
    })();
  }, [refreshServers]);

  const login = useCallback(async (u: string, _pwd: string, serverId: string, remember: boolean) => {
    const auth = await authService.login(u, u, serverId, remember);
    setIsLoggedIn(true);
    setUsername(auth.username);
    setNickname(auth.nickname);
    await refreshServers();
  }, [refreshServers]);

  const logout = useCallback(async () => {
    await authService.logout();
    setIsLoggedIn(false);
    setNickname('');
    setUsername('');
    setCurrentServer(null);
  }, []);

  const switchServer = useCallback(async (id: string) => {
    await authService.switchServer(id);
    await refreshServers();
  }, [refreshServers]);

  const addServer = useCallback(async (name: string, baseUrl: string) => {
    await authService.addServer(name, baseUrl);
    await refreshServers();
  }, [refreshServers]);

  const updateServer = useCallback(async (id: string, name: string, baseUrl: string) => {
    await authService.updateServer(id, name, baseUrl);
    await refreshServers();
  }, [refreshServers]);

  const removeServer = useCallback(async (id: string) => {
    await authService.removeServer(id);
    await refreshServers();
  }, [refreshServers]);

  if (!ready) return null;

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, nickname, username, currentServer, servers, login, logout, switchServer, addServer, updateServer, removeServer, refreshServers }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}