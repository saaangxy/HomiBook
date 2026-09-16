import { useEffect, useRef } from 'react';
import { useShareIntentContext } from 'expo-share-intent';
import { showToast } from '@/components/chrome/Toast';
import { useUIShell } from '@/components/chrome/chrome';
import { useAuth } from '@/stores/auth';
import { guessMimeFromName } from '@/services/http';
import { enqueueShareInbox, flushShareInbox, shareInboxCount, uploadShareItems, type ShareInboxItem } from '@/services/share-inbox';

// 系统分享图片直达 AI 聊天(仅 Android;intent-filter 配置见 mobile/app.json)。
// 收到分享:立即上传 → 结果作为聊天待发附件 → 打开 AI 财务助手弹窗。
// 未登录 / 上传失败时先落「分享收件箱」,登录完成后自动续跑(补上传 + 打开弹窗),避免分享内容丢失。
//
// iOS 未实现:分享扩展需要独立的 Share Extension target + App Group 共享容器,
// 且配置插件会在 prebuild 时改写 Xcode 工程,本期不引入(详见 example/图片分享与短信记账方案.md)。

/** 分享文件转待上传项:意图过滤器已限定 image/*,这里只兜底缺失或异常的 mimeType */
function toInboxItems(files: { path: string; fileName?: string; mimeType: string }[]): ShareInboxItem[] {
  return files.map((f) => {
    const name = f.fileName || 'attachment';
    const guessed = guessMimeFromName(name);
    const mimeType = f.mimeType?.startsWith('image/') ? f.mimeType : guessed;
    return { path: f.path, name, mimeType: mimeType === 'application/octet-stream' ? 'image/jpeg' : mimeType };
  });
}

export function useShareIntake() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { isLoggedIn } = useAuth();
  const { aiOpen, openAI, pushPendingShare } = useUIShell();
  // 已处理意图指纹:防 onNewIntent 重放与状态抖动导致的重复上传
  const handledRef = useRef<string | null>(null);
  // 上一次登录态:识别「刚进入登录态」以续跑未完成的分享
  const prevLoggedRef = useRef(isLoggedIn);
  // 补传互斥:登录态与弹窗开关同帧变化时,避免同一批暂存图片被上传两次
  const flushingRef = useRef(false);
  // shell/库回调经 ref 取用:它们的身份随状态变化,直接进依赖会让 effect 无谓重跑
  const pushRef = useRef(pushPendingShare);
  pushRef.current = pushPendingShare;
  const openRef = useRef(openAI);
  openRef.current = openAI;
  const resetRef = useRef(resetShareIntent);
  resetRef.current = resetShareIntent;

  // 意图清空后解除去重标记:用户连续分享同一张图片仍能正常处理
  useEffect(() => {
    if (!hasShareIntent) handledRef.current = null;
  }, [hasShareIntent]);

  useEffect(() => {
    if (!hasShareIntent) return;
    const files = shareIntent.files ?? [];
    const text = (shareIntent.text ?? '').trim();
    if (files.length === 0 && !text) return;
    const fingerprint = `${shareIntent.type ?? ''}|${files.map((f) => f.path).join(',')}|${text}`;
    if (handledRef.current === fingerprint) return;
    handledRef.current = fingerprint;

    const items = toInboxItems(files);
    // 先清原生态意图:上传是异步的,不清会被回前台重复触发
    resetRef.current();

    void (async () => {
      if (!isLoggedIn) {
        // 未登录:先落收件箱,登录完成后自动续跑
        await enqueueShareInbox(items);
        showToast(items.length > 0 ? '已收到图片,登录后自动添加到 AI 助手' : '登录后可将分享内容发给 AI 助手');
        return;
      }
      const uploaded = await uploadShareItems(items);
      if (uploaded.length === 0 && !text) {
        showToast('图片上传失败,已暂存,稍后自动重试');
        return;
      }
      pushRef.current({ attachments: uploaded, text: text || undefined });
      openRef.current();
    })();
  }, [hasShareIntent, shareIntent, isLoggedIn]);

  // 补传并续跑暂存的分享:进入登录态(含启动即已登录)后自动补上传并打开 AI 助手;
  // aiOpen 变化时再试一次(兜底:上次网络/凭据异常留下的暂存项)
  useEffect(() => {
    if (!isLoggedIn) {
      prevLoggedRef.current = false;
      return;
    }
    // 首次进入登录态同样算「刚登录」:续跑上次未登录时分享的图片
    const justLoggedIn = !prevLoggedRef.current;
    prevLoggedRef.current = true;
    if (flushingRef.current) return;
    flushingRef.current = true;
    void (async () => {
      try {
        // 无暂存分享时不做任何事(启动时的登录态恢复也会走到这里)
        if ((await shareInboxCount()) === 0) return;
        const attachments = await flushShareInbox();
        if (attachments.length === 0) {
          if (justLoggedIn) showToast('暂存的分享图片上传失败,请打开 AI 助手重新发送');
          return;
        }
        pushRef.current({ attachments });
        openRef.current();
      } finally {
        flushingRef.current = false;
      }
    })();
    // aiOpen 为「打开 AI 助手时重试」的触发条件,不在回调体内直接读取
  }, [isLoggedIn, aiOpen]);
}

/** 分享接收桥接:挂在 UIShellProvider 内层,自身不渲染任何内容 */
export function ShareIntakeBridge() {
  useShareIntake();
  return null;
}
