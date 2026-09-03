import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as authService from '@/services/auth';
import type { ServerCredential } from '@/services/auth';
import { clearCredential, getCredential, isCredentialExpired, setUnauthorizedHandler } from '@/services/http';
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
  login: (account: string, password: string, serverId: string) => Promise<void>;
  loginWithApiKey: (key: string, serverId: string) => Promise<void>;
  logout: () => Promise<void>;
  switchServer: (id: string) => Promise<void>;
  /** 一键登录:切换服务器 → 用该服务器内置的账号密码(或 API Key)自动登录 */
  quickLogin: (id: string) => Promise<{ ok: boolean; error?: string }>;
  addServer: (name: string, baseUrl: string, cred?: ServerCredential) => Promise<void>;
  updateServer: (id: string, name: string, baseUrl: string, cred?: ServerCredential) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  refreshServers: () => Promise<void>;
  /** 更新昵称(个人信息页;服务端成功后同步本地 user) */
  updateNickname: (nickname: string) => Promise<void>;
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
  // lastServerSyncRef:记录最近一次「服务器 → 本机」下行的值,防止上行 effect 把下行误判为本机切换而回传
  const lastServerSyncRef = useRef<string | null>(null);
  const syncTheme = useCallback(
    (theme: string) => {
      if ((theme === 'system' || theme in palettes) && theme !== themeId) {
        lastServerSyncRef.current = theme;
        setThemeId(theme as ThemeId);
      }
    },
    [themeId, setThemeId],
  );

  // 本机主题上行:登录态且与账号不一致时上传到服务器(与网页端共享;失败静默,不影响本地)
  useEffect(() => {
    if (!isLoggedIn || !user) return;
    if (themeId === user.theme) return; // 已与服务器一致
    if (lastServerSyncRef.current === themeId) return; // 本次变化源自服务器下行,防环
    lastServerSyncRef.current = themeId;
    authService.apiUpdateTheme(themeId).then((updated) => {
      setUser((prev) => (prev ? { ...prev, theme: updated.theme } : prev));
    }).catch(() => {});
  }, [themeId, isLoggedIn, user]);

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
      // 凭据已过期 → 清除并保持登出,需重新登录
      if (isCredentialExpired(cred)) {
        await clearCredential();
        setReady(true);
        return;
      }
      if (cred) {
        // 凭据未过期 → 直接恢复登录态(本地判断,离线也可进入页面)
        setIsLoggedIn(true);
        // 后台刷新用户信息与主题(失败不登出,真正失效由 401 拦截器兜底)
        authService.apiMe().then((me) => {
          setUser(me);
          syncTheme(me.theme);
        }).catch(() => {});
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (account: string, password: string, serverId: string) => {
      await authService.switchServer(serverId);
      const me = await authService.apiLogin(account, password);
      // 登录成功后把账号密码写回服务器配置,便于下次选服务器一键登录
      await authService.bindServerCredential(serverId, { account, password });
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
      // 登录成功后把 API Key 写回服务器配置
      await authService.bindServerCredential(serverId, { apiKey: key });
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

  // 一键登录:切换服务器 → 用该服务器内置的账号密码(或 API Key)自动登录
  const quickLogin = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        await authService.switchServer(id);
        await refreshServers();
        const server = servers.find((s) => s.id === id);
        if (!server) return { ok: false, error: '服务器不存在' };
        // 优先 API Key,其次账号+密码
        if (server.apiKey) {
          const me = await authService.verifyApiKey(server.apiKey);
          setUser(me);
          setIsLoggedIn(true);
          syncTheme(me.theme);
          await refreshServers();
          return { ok: true };
        }
        if (server.account && server.password) {
          const me = await authService.apiLogin(server.account, server.password);
          setUser(me);
          setIsLoggedIn(true);
          syncTheme(me.theme);
          await refreshServers();
          return { ok: true };
        }
        return { ok: false, error: '该服务器未配置账号密码或 API Key,请手动登录' };
      } catch (e: any) {
        return { ok: false, error: e?.message ?? '登录失败' };
      }
    },
    [refreshServers, servers, syncTheme],
  );

  const addServer = useCallback(async (name: string, baseUrl: string, cred?: ServerCredential) => {
    await authService.addServer(name, baseUrl, cred);
    await refreshServers();
  }, [refreshServers]);

  const updateServer = useCallback(async (id: string, name: string, baseUrl: string, cred?: ServerCredential) => {
    await authService.updateServer(id, name, baseUrl, cred);
    await refreshServers();
  }, [refreshServers]);

  const removeServer = useCallback(async (id: string) => {
    // 乐观移除:立即从本地 state 移除,确保 UI 即时反馈(再持久化 + 最终同步)
    setServers((prev) => prev.filter((s) => s.id !== id));
    await authService.removeServer(id);
    await refreshServers();
  }, [refreshServers]);

  // 更新昵称:服务端成功后同步本地 user(设置页顶栏/用户卡即时一致)
  const updateNickname = useCallback(async (nickname: string) => {
    const me = await authService.apiUpdateNickname(nickname);
    setUser((prev) => (prev ? { ...prev, nickname: me.nickname } : prev));
  }, []);

  // 注意:useMemo 必须在条件 return 之前调用(不能跳过 hooks)
  const value = useMemo(
    () => ({
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
      quickLogin,
      addServer,
      updateServer,
      removeServer,
      refreshServers,
      updateNickname,
    }),
    [isLoggedIn, user, currentServer, servers, login, loginWithApiKey, logout, switchServer, quickLogin, addServer, updateServer, removeServer, refreshServers, updateNickname],
  );

  if (!ready) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
