/**
 * 导入账单消息的文案 —— 发送侧 / 后端技能检测 / 渲染侧共用一份。
 *
 * 这里**不再编码任何 id**:账单文件本身就是一个聊天附件,它的 attachmentId 由附件清单
 * (backend context-inject 的 buildAttachmentSection)下发给模型,不必在自然语言里再抄一遍。
 * 旧版协议抄的是另一套 id(fileId,来自只写盘不落库的临时文件通道),模型经常把它和
 * attachmentId 混用导致「文件不存在」,已随导入链路统一到 attachmentId 而废弃。
 */
import { IMPORT_SOURCE_LABELS } from '../record-import.js';

/** 导入请求消息的固定前缀:后端 import-transactions 技能据此判定「这是导入请求」 */
export const IMPORT_MESSAGE_PREFIX = '请导入';

/** 编码导入账单消息(发送侧):一句自然语言请求,文件标识走附件清单 */
export function buildImportMessage(meta: { source: string }): string {
  const label = IMPORT_SOURCE_LABELS[meta.source] ?? meta.source;
  return `${IMPORT_MESSAGE_PREFIX}${label}账单文件`;
}

/**
 * 解码**旧版**导入消息(渲染侧兼容)。
 *
 * v1 协议把 fileId/source/文件名编码进文本(`请导入微信账单文件\nfileId: x\nsource: wechat\n文件名: y`),
 * 已废弃,但历史会话里的消息仍是那个格式 —— 保留解析,避免旧消息渲染成一堆元数据行。
 * 新版消息只含一句「请导入XX账单文件」,这里返回 null,按普通文本渲染(文件由 attachments 渲染成附件 chip)。
 */
export function parseImportMessage(text: string): { desc: string; fileName: string; source: string } | null {
  const m = text.match(/^([\s\S]*?)\s*\nfileId:\s*(\S+)\s*\nsource:\s*(\S+)\s*\n文件名:\s*(.+?)\s*$/);
  if (!m) return null;
  return { desc: m[1].trim(), fileName: m[4], source: IMPORT_SOURCE_LABELS[m[3]] ?? m[3] };
}
