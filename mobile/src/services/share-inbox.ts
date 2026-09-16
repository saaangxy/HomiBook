import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadImage } from './chat';
import { resolveRemoteUrl } from './http';

// 分享收件箱:系统分享进来的图片若没法立即上传(未登录 / 未配置服务器 / 网络失败),
// 先把本地文件路径暂存,等条件满足(登录完成 / 打开 AI 助手)再补上传,避免用户分享的图片被丢弃。
// 注:暂存的是 expo-share-intent 已复制到应用 cacheDir 的文件,短时间内有效。

const KEY = 'homibook.shareInbox';

/** 收件箱条目:待上传的分享文件(本地路径可直读) */
export interface ShareInboxItem {
  path: string;
  name: string;
  mimeType: string;
}

/** 已上传的分享附件(与聊天待发附件同结构) */
export interface ShareAttachment {
  id: string;
  uri: string;
  fullUrl: string;
  originalFilename: string;
}

/** 分享意图转成的聊天草稿:待发附件 + 预填文本 */
export interface PendingShare {
  attachments: ShareAttachment[];
  text?: string;
}

async function readInbox(): Promise<ShareInboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as ShareInboxItem[]) : [];
  } catch {
    return [];
  }
}

async function writeInbox(items: ShareInboxItem[]): Promise<void> {
  try {
    if (items.length === 0) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 存储不可用时放弃暂存(不阻断分享主流程)
  }
}

/** 追加到收件箱(按本地路径去重,避免重复分享堆积) */
export async function enqueueShareInbox(items: ShareInboxItem[]): Promise<void> {
  if (items.length === 0) return;
  const cur = await readInbox();
  const seen = new Set(cur.map((it) => it.path));
  const added = items.filter((it) => !seen.has(it.path));
  if (added.length === 0) return;
  await writeInbox([...cur, ...added]);
}

/** 暂存数量(0 表示没有待补传的分享) */
export async function shareInboxCount(): Promise<number> {
  return (await readInbox()).length;
}

/** 逐个上传,失败项不抛错而是收集起来 */
async function uploadAll(items: ShareInboxItem[]): Promise<{ uploaded: ShareAttachment[]; failed: ShareInboxItem[] }> {
  const uploaded: ShareAttachment[] = [];
  const failed: ShareInboxItem[] = [];
  for (const it of items) {
    try {
      const up = await uploadImage(it.path, it.name, it.mimeType);
      const url = up.fullUrl || up.url;
      uploaded.push({ id: up.id, uri: resolveRemoteUrl(url), fullUrl: url, originalFilename: it.name });
    } catch {
      failed.push(it);
    }
  }
  return { uploaded, failed };
}

/** 立即上传:成功项返回;失败项自动落收件箱待补传 */
export async function uploadShareItems(items: ShareInboxItem[]): Promise<ShareAttachment[]> {
  if (items.length === 0) return [];
  const { uploaded, failed } = await uploadAll(items);
  await enqueueShareInbox(failed);
  return uploaded;
}

/** 补上传收件箱:成功项移出队列并返回上传结果,失败的项保留待下次重试 */
export async function flushShareInbox(): Promise<ShareAttachment[]> {
  const cur = await readInbox();
  if (cur.length === 0) return [];
  const { uploaded, failed } = await uploadAll(cur);
  await writeInbox(failed);
  return uploaded;
}
