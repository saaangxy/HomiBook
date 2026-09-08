/**
 * 工具卡状态机 —— 历史消息的 tool-call 块 status=pending 时按已有字段反推真实状态。
 * 中间态(confirming/suggesting/switching)不持久化,渲染时统一推断:
 * web ToolCallCard 与 mobile ToolCard 共用此单一来源,勿在端内复制推断规则。
 */
import type { ToolCallEntry } from '../types/index.js';

export interface ToolStatusResolution {
  effectiveStatus: ToolCallEntry['status'];
  /** suggest_options 推断出的建议内容(历史数据无 suggestion 字段时补齐) */
  effectiveSuggestion?: ToolCallEntry['suggestion'];
  isExpired: boolean;
  expiredMessage?: string;
}

export function resolveToolCallStatus(toolCall: ToolCallEntry): ToolStatusResolution {
  if (toolCall.status !== 'pending') {
    return { effectiveStatus: toolCall.status, effectiveSuggestion: toolCall.suggestion, isExpired: false, expiredMessage: undefined };
  }
  // decisionData 仅由端内 decideTool 批准时暂存（不持久化）：表示用户已决定、等待续流结果，不属于历史重载过期场景
  const decided = toolCall.decisionData != null;
  // suggest_options 有 questions 参数 → 实际在等待用户选择
  if (toolCall.toolName === 'suggest_options') {
    const questions = (toolCall.args as any)?.questions;
    if (questions?.length > 0) {
      return { effectiveStatus: 'suggesting', effectiveSuggestion: { questions }, isExpired: !decided, expiredMessage: undefined };
    }
  }
  // switch_book 有 result 带 books → 实际在等待用户选择
  if (toolCall.toolName === 'switch_book') {
    const books = (toolCall.result as any)?.books;
    if (books?.length > 0) {
      return { effectiveStatus: 'switching', effectiveSuggestion: undefined, isExpired: !decided, expiredMessage: decided ? undefined : '切换操作已过期，请重新发起' };
    }
  }
  // 有 result → 实际已执行成功
  if (toolCall.result != null) return { effectiveStatus: 'success', effectiveSuggestion: undefined, isExpired: false, expiredMessage: undefined };
  // 有 preview → 等待确认
  if (toolCall.preview) return { effectiveStatus: 'confirming', effectiveSuggestion: undefined, isExpired: true, expiredMessage: undefined };
  // preview_import 预览模式但没有 result → 预览数据未持久化
  if (toolCall.toolName === 'preview_import' && (toolCall.args as any)?.mode === 'preview') {
    return { effectiveStatus: 'error', effectiveSuggestion: undefined, isExpired: true, expiredMessage: '导入预览数据已过期，请重新上传文件发起导入' };
  }
  // confirm_import 但没有 result → 确认状态未持久化
  if (toolCall.toolName === 'confirm_import') {
    return { effectiveStatus: 'error', effectiveSuggestion: undefined, isExpired: true, expiredMessage: '导入确认已过期，请重新发起导入' };
  }
  return { effectiveStatus: 'pending', effectiveSuggestion: undefined, isExpired: false, expiredMessage: undefined };
}
