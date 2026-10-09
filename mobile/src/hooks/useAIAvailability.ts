import { useEffect, useState } from 'react';
import { aiAdminApi } from '@/services/settings';

/**
 * AI 助手可用性(与 web `pages/HomePage` 同一套语义):
 *   - `enabled === false`      —— 用户在设置里关掉了 AI 助手 ⇒ **入口整体隐藏**;
 *   - `enabled && !configured` —— 开着但没配模型 ⇒ **入口保留并提示「去配置」**,
 *     别让用户点进去才发现用不了。
 *
 * 数据源 `GET /api/chat/ai-config`(已封装为 `aiAdminApi.fetchAIConfig`),**无需后端改动**。
 * 「已配置」判定与后端 `routes/chat.ts` 的 `hasSimple || hasComplex` 同口径 ——
 * 只配了复杂模型也算可用(只看 simple 槽位会误判)。
 *
 * 注:这里刻意不调用 `useIsFocused` —— 记一笔弹窗挂在 `_layout` 上、不在 router 的
 * screen 上下文里,用它会直接抛错。改由调用方通过 `refreshKey` 决定何时重读。
 *
 * @param refreshKey 变化时重读:首页传 `isFocused`(切回本页时可能刚去设置里配好),
 *                   记一笔传弹窗开关。不传则仅挂载时读一次。
 */
export interface AIAvailability {
  /** 用户在设置里启用了 AI 助手(总开关) */
  enabled: boolean;
  /** 已配置可用模型(简单或复杂槽位任一) */
  configured: boolean;
  /** 入口可用 = 已启用且已配置 */
  ready: boolean;
  /** 首次读取中:此时不宜「先隐藏入口、拿到结果再闪出来」 */
  loading: boolean;
}

export function useAIAvailability(refreshKey?: unknown): AIAvailability {
  const [state, setState] = useState({ enabled: false, configured: false, loading: true });

  useEffect(() => {
    // 包一层 async:避免在 effect 体内同步 setState(react-hooks/set-state-in-effect)
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await aiAdminApi.fetchAIConfig();
        if (cancelled) return;
        setState({
          enabled: !!cfg.enabled,
          configured: !!(cfg.simpleProviderConfigId || cfg.complexProviderConfigId),
          loading: false,
        });
      } catch {
        // 读不到配置时保守处理:按「未启用」隐藏入口,而不是留一个点不开的入口
        if (cancelled) return;
        setState({ enabled: false, configured: false, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { ...state, ready: state.enabled && state.configured };
}
