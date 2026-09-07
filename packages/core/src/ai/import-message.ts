/**
 * 导入账单消息的文本协议 —— 发送侧编码 / 渲染侧解码单一来源。
 * 元数据编码进自然语言供后端 AI 解析并调用 preview_import 工具;协议与 AI 提示词耦合,
 * 改动字段需同步 后端提示词 + 两端发送/渲染(改这里即可,勿在端内另写拼接或正则)。
 */
import { IMPORT_SOURCE_LABELS } from '../record-import.js';

/** 编码导入账单消息(发送侧):AI 从该文本解析 fileId/source 并调用 preview_import */
export function buildImportMessage(meta: { fileId: string; source: string; fileName: string }): string {
  const label = IMPORT_SOURCE_LABELS[meta.source] ?? meta.source;
  return `请导入${label}账单文件\nfileId: ${meta.fileId}\nsource: ${meta.source}\n文件名: ${meta.fileName}`;
}

/** 解码导入账单消息(渲染侧):命中返回元数据(source 为展示标签),非导入消息返回 null */
export function parseImportMessage(text: string): { desc: string; fileName: string; source: string } | null {
  const m = text.match(/^([\s\S]*?)\s*\nfileId:\s*(\S+)\s*\nsource:\s*(\S+)\s*\n文件名:\s*(.+?)\s*$/);
  if (!m) return null;
  return { desc: m[1].trim(), fileName: m[4], source: IMPORT_SOURCE_LABELS[m[3]] ?? m[3] };
}
