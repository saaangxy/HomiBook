/**
 * 短信 / 通知记账 —— AI 兜底解析的契约与换算(三端共享,避免字段漂移)。
 *
 * 定位:本地规则解析读不懂的**长尾**文本(地方银行/农信社、字段顺序怪异、通知标题正文拼接)
 * 才走这条路。本地已命中的正文永不上送;开关默认关闭,且只上送通过用户筛选规则的未识别内容。
 *
 * 边界:LLM 只负责「文本 → 字段」。账户匹配、分类映射、去重、入账仍走既有确定性管线
 * (services/import/pipeline.ts + /api/records/import),模型输出只作为候选,必须人工确认。
 */
import type { RecordType } from './types/index.js';
import { buildAccountLabel, type SmsTransactionCandidate } from './sms-parse.js';

/** 送 AI 解析的一条内容(正文是唯一的敏感字段) */
export interface SmsAiExtractItem {
  /** 来源消息 id(回填候选与「已处理」标记用) */
  sourceId: string;
  /** 原文(短信正文 / 通知「标题 + 正文」) */
  text: string;
  /** 发件号码 / 通知来源包名 */
  sender: string | null;
  /** 到达时刻 ISO:正文里读不到时间时用它兜底 */
  receivedAt: string;
  channel: 'sms' | 'notification';
}

/** 单批上限:控制单次请求的 token 与失败半径 */
export const SMS_AI_BATCH_SIZE = 20;
/** 单次扫描最多兜底条数 */
export const SMS_AI_MAX_ITEMS = 50;
/** 单条正文截断长度:超长文本对字段抽取无增益,只烧 token */
export const SMS_AI_MAX_TEXT_LENGTH = 500;

/**
 * 服务端校验后的抽取结果。
 * 不可信字段一律为 null(交人工),**不做静默归一化**:模型给了非法枚举/越界金额时,
 * 宁可置空并记入 notes,也不猜一个值落库。
 */
export interface SmsAiExtractCandidate {
  sourceId: string;
  /** 模型判定为「不是一笔交易」→ 调用方直接丢弃 */
  isTransaction: boolean;
  date: string | null;
  /** 恒为正数;方向看 type */
  amount: number | null;
  type: RecordType | null;
  bankName: string | null;
  cardTail: string | null;
  tradeKind: string | null;
  payer: string | null;
  /** 摘要备注(不含正文) */
  remark: string | null;
  /** 置信度 0~1(模型自评;服务端校验会下调) */
  confidence: number;
  /** 校验说明:如「金额越界已置空」「方向不在枚举内」,便于排查 */
  notes: string[];
}

/** AI 解析开关(本机偏好,默认关闭) */
export interface SmsAiExtractSettings {
  enabled: boolean;
}

/** 把正文裁到上限(按字符计;短信/通知都在数百字内) */
export function truncateSmsAiText(text: string, limit: number = SMS_AI_MAX_TEXT_LENGTH): string {
  const body = (text ?? '').trim();
  return body.length > limit ? body.slice(0, limit) : body;
}

/**
 * AI 结果 → 本机候选(与 parseTransactionSms 同形,可直接并入候选列表)。
 * - 非交易、或缺金额 → 返回 null(调用方丢弃)
 * - 时间缺失用到达时刻兜底;**方向未知置 UNKNOWN**,由后端归入「未识别记录」交人工指定
 * - 账户名沿用本地解析同一套标签规则(buildAccountLabel),不采信模型自造的名字
 * - 不含 dedupeKey/channel:与本地候选一样由调用方补齐(保持两条路径同形)
 */
export function toSmsCandidateFromAi(
  candidate: SmsAiExtractCandidate,
  item: SmsAiExtractItem,
): SmsTransactionCandidate | null {
  if (!candidate.isTransaction) return null;
  const amount = Math.abs(Number(candidate.amount ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const bankName = candidate.bankName?.trim() || null;
  const cardTail = candidate.cardTail?.trim() || null;
  const accountLabel = buildAccountLabel(bankName, cardTail);
  const tradeKind = candidate.tradeKind?.trim() || null;
  const payer = candidate.payer?.trim() || null;

  const issued = candidate.date ? new Date(candidate.date) : null;
  const date = issued && !isNaN(issued.getTime()) ? issued.toISOString() : item.receivedAt;

  const confidence = Math.min(0.95, Math.max(0.2, Number(candidate.confidence) || 0.5));

  const result: SmsTransactionCandidate = {
    sourceId: item.sourceId,
    raw: item.text,
    sender: item.sender,
    bankName,
    cardTail,
    date,
    amount,
    type: candidate.type ?? 'UNKNOWN',
    tradeKind,
    payer,
    accountName: accountLabel,
    remark: [item.channel === 'notification' ? '通知' : '短信', 'AI', accountLabel, tradeKind, payer]
      .filter(Boolean).join(' '),
    balance: null,
    confidence,
  };
  return result;
}
