import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as authService from '@/services/auth';
import { clearCredential, getCredential, setUnauthorizedHandler } from '@/services/http';
import { palettes, useTheme, type ThemeId } from '@/theme';
import type { Server, UserInfo } from '@/types';

interface AuthStore {
  isLoggedIn: boolean;
  user: UserInfo | null;
  /** 兼容字段:派生自 user */
  nickname: string;
  username: string;
  currentServer: Server | null;
  servers: Server[];
  login: (account: string, password: string, serverId: string, remember: boolean) => Promise<void>;
  loginWithApiKey: (key: string, serverId: string) => Promise<void>;
  logout: () => Promise<void>;
  switchServer: (id: string) => Promise<void>;
  addServer: (name: string, baseUrl: string, account?: string) => Promise<void>;
  updateServer: (id: string, name: string, baseUrl: string, account?: string) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  refreshServers: () => Promise<void>;
}

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { themeId, setThemeId } = useTheme();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [currentServer, setCurrentServer] = useState<Server | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [ready, setReady] = useState(false);

  // 账号主题同步到本机(与网页端共享 user.theme)
  const syncTheme = useCallback(
    (theme: string) => {
      if ((theme === 'system' || theme in palettes) && theme !== themeId) setThemeId(theme as ThemeId);
    },
    [themeId, setThemeId],
  );

  const refreshServers = useCallback(async () => {
    const [list, cur] = await Promise.all([authService.fetchServers(), authService.getCurrentServer()]);
    setServers(list);
    setCurrentServer(cur);
  }, []);

  // 启动:注册 401 拦截 → 恢复服务器 → 凭据存在则恢复会话
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearCredential();
      setUser(null);
      setIsLoggedIn(false);
    });
    (async () => {
      await refreshServers();
      const cred = await getCredential();
      if (cred) {
        try {
          const me = await authService.apiMe();
          setUser(me);
          setIsLoggedIn(true);
          syncTheme(me.theme);
        } catch {
          // 401 已由拦截器清理;网络错误保持登出,凭据留待下次重试
        }
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (account: string, password: string, serverId: string, remember: boolean) => {
      await authService.switchServer(serverId);
      const me = await authService.apiLogin(account, password);
      if (remember) await authService.saveRemembered(account, password);
      else await authService.clearRemembered();
      // 绑定账号到服务器(本机持久化)
      await authService.bindServerAccount(serverId, account);
      setUser(me);
      setIsLoggedIn(true);
      syncTheme(me.theme);
      await refreshServers();
    },
    [refreshServers, syncTheme],
  );

  const loginWithApiKey = useCallback(
    async (key: string, serverId: string) => {
      await authService.switchServer(serverId);
      const me = await authService.verifyApiKey(key);
      setUser(me);
      setIsLoggedIn(true);
      syncTheme(me.theme);
      await refreshServers();
    },
    [refreshServers, syncTheme],
  );

  const logout = useCallback(async () => {
    await authService.apiLogout();
    setUser(null);
    setIsLoggedIn(false);
    // 服务器列表与当前服务器保留,便于下次直接登录
  }, []);

  const switchServer = useCallback(async (id: string) => {
    await authService.switchServer(id);
    await refreshServers();
  }, [refreshServers]);

  const addServer = useCallback(async (name: string, baseUrl: string, account?: string) => {
    await authService.addServer(name, baseUrl, account);
    await refreshServers();
  }, [refreshServers]);

  const updateServer = useCallback(async (id: string, name: string, baseUrl: string, account?: string) => {
    await authService.updateServer(id, name, baseUrl, account);
    await refreshServers();
  }, [refreshServers]);

  const removeServer = useCallback(async (id: string) => {
    await authService.removeServer(id);
    await refreshServers();
  }, [refreshServers]);

  if (!ready) return null;

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        user,
        nickname: user?.nickname ?? '',
        username: user?.username ?? user?.email ?? '',
        currentServer,
        servers,
        login,
        loginWithApiKey,
        logout,
        switchServer,
        addServer,
        updateServer,
        removeServer,
        refreshServers,
      }}
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
