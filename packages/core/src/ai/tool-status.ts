/**
 * 工具卡状态机 —— 历史消息的 tool-call 块 status=pending 时按已有字段反推真实状态。
 * 中间态(confirming/suggesting/switching)不持久化,渲染时统一推断:
 * web ToolCallCard 与 mobile ToolCard 共用此单一来源,勿在端内复制推断规则。
 */
import type { ToolCallEntry } from '../types/index.js';

/**
 * 该工具调用是否仍在等用户操作。
 *
 * 与「等待确认/选择」的状态区分开：preview_import / confirm_import 是 requireConfirm=false 的工具，
 * 执行成功（status=success）但仍要用户点「确认导入」。若不把它们算作「未完成」，
 * 用户只点同一轮里的其中一张卡就会立刻把 decisions 提交给后端，而那条 assistant 消息里
 * 其它 tool_call 还没有 tool 结果，上游会拒：
 *   An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'
 * 因此 web / mobile 的 decideTool 都靠这里判断「是否要等同一条消息里所有卡都点完」。
 *
 * **判定必须与 UI 真正渲染出的卡片一致**，否则会把没有按钮的块也算成「等用户点」而永远卡住：
 *   - preview_import 只有 mode='preview' 才渲染交互卡（导入流程第一步的 mode='analyze' 是查询，直接返回数据）
 *   - confirm_import 只有 mode='confirm_preview' 才渲染确认卡（执行完的 imported 回执不需要点）
 */
export function isAwaitingUserAction(toolCall: ToolCallEntry): boolean {
  // 一律用 resolveToolCallStatus 的 effectiveStatus，**不要读原始 status**：
  // 从历史加载的块原始 status 可能还是 'pending'，但带 result 时 UI 会按 success 渲染出卡片
  // （见 ToolCallCard 的 showResult），读原始 status 会漏掉这些卡，「剩余 N 个」就永远不显示。
  const { effectiveStatus } = resolveToolCallStatus(toolCall);
  if (effectiveStatus === 'confirming' || effectiveStatus === 'suggesting' || effectiveStatus === 'switching') {
    /**
     * 已点过(decided)的中间态块不再算「等用户点」。
     * decideTool 提交前会把该块 status 归回 pending 并暂存 decisionData，而 resolveToolCallStatus 仍会
     * 依 args.questions / result.books 推导出 suggesting / switching → 不排除 decided 的话，
     * 刚点完的「建议选项」「切换账本」卡又被算作待操作，awaiting 永远 > 0 → 永不提交 /confirm
     * （表现为：点「提交」按钮进入 loading 后无任何请求、界面无反应）。
     */
    return !toolCall.decided;
  }

  const args = (toolCall.args ?? {}) as Record<string, unknown>;
  const data = (toolCall.result as { data?: { mode?: string; confirmed?: boolean } } | undefined)?.data;
  const isCard = (toolCall.toolName === 'preview_import' && args.mode === 'preview' && toolCall.result != null)
    || (toolCall.toolName === 'confirm_import' && data?.mode === 'confirm_preview');
  if (!isCard) return false;

  // 点过（decided）/ 后端已回 confirmed 的卡不再拦
  if (effectiveStatus !== 'success' || toolCall.decided) return false;
  return data?.confirmed !== true;
}

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
