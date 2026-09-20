/**
 * 短信 / 通知 —— 长尾文本的结构化抽取(AI 兜底)。
 *
 * 定位:只处理**本地规则解析读不懂**的内容(预筛判为「没有交易字眼/读不出金额」或解析返回 null)。
 * 本地已产出候选的正文永不上送;开关在客户端,默认关闭。
 *
 * 确定性优先:模型输出**一律经过校验**才能成为候选 ——
 *   金额必须是原文里的正数且有限;时间必须可解析(否则置 null,由客户端用到达时刻兜底);
 *   方向必须命中枚举(否则置 null → 客户端按 UNKNOWN 处理,由用户指定);
 *   尾号必须正好 4 位数字;字符串按长度截断。
 * 校验不通过不是「报错」而是「置空 + notes」:候选仍需用户在确认卡里核对,不接受静默归一化。
 *
 * 本模块**不做**账户匹配 / 分类映射 / 去重 —— 那仍走既有的确定性管线(pipeline.ts + /api/records/import),
 * 客户端把抽取结果并入候选后会再调一次 /api/sms/preview。
 */
import { generateText } from 'ai'
import {
  isRecordType,
  SMS_AI_BATCH_SIZE,
  SMS_AI_MAX_TEXT_LENGTH,
  truncateSmsAiText,
  type SmsAiExtractCandidate,
  type SmsAiExtractItem,
} from '@homibook/core'
import { prisma } from '../../app.js'
import { loadUserProviderConfig } from './security.js'
import { createModel, DEFAULT_BASE_URLS, type ProviderType } from './providers.js'

/** 逐字节固定的系统提示词:静态内容可命中前缀缓存(与聊天链路同一考虑) */
const SYSTEM_PROMPT = `你是银行/支付短信与通知的字段抽取器。输入是一个 JSON 数组,每项含 i(序号)、sender(发件号码或应用包名)、receivedAt(到达时间 ISO)、text(原文)。

任务:判断每项是否为「一笔真实的资金交易」,并抽取字段。只输出 JSON 数组,不要解释、不要 markdown 代码块。

每项输出字段:
- i: 原样返回输入序号(整数)
- isTransaction: 布尔。验证码、营销推广、账单/还款提醒、额度调整、登录提醒、单纯余额提醒 → false
- amount: 数字,恒为正数,不含符号与千分位;读不到 → null
- type: "INCOME" | "EXPENSE" | "TRANSFER" | null。收入/入账/转入/退款 → INCOME;支出/消费/扣款/转支/转出/代扣/取现 → EXPENSE;账户间转账且分不清方向 → TRANSFER;不确定 → null
- date: 交易发生时间,输出 "YYYY-MM-DDTHH:mm:ss+08:00"(短信里的时间都是北京时间)。只有日期没有时分 → 补 12:00:00;只有时分没有日期 → 用 receivedAt 的日期;读不到 → null
- bankName: 机构名(如「中国农业银行」「支付宝」「微信」);读不到 → null
- cardTail: 卡号后四位,必须正好 4 位数字;读不到 → null
- tradeKind: 交易类型原文(如「转支」「消费」「代扣」「取现」);读不到 → null
- payer: 交易对手或商户名;读不到 → null
- remark: 一句简短摘要(不超过 30 字,不要复述全文);读不到 → null
- confidence: 0~1 的数字,表示你对该项抽取结果的把握程度

硬性要求:
- 不要臆造任何字段:读不到一律 null,不要猜金额、不要补日期、不要编机构名。
- amount 只能取原文中的数字,不要做任何计算。
- 输出数组长度必须与输入相同,i 必须与输入一一对应。`

/** 模型自评字段的长度上限(超长按截断,避免脏数据进库) */
const FIELD_LIMITS = { bankName: 30, cardTail: 4, tradeKind: 20, payer: 60, remark: 120 } as const

interface ExtractModelConfig {
  provider: ProviderType
  model: string
  apiKey: string
  baseURL: string
}

/** 读取用于抽取的模型配置:优先简单任务模型(抽取是轻任务,与意图分类同一档) */
async function loadExtractConfig(userId: string): Promise<ExtractModelConfig | null> {
  const prefs = await prisma.userAIConfig.findUnique({ where: { userId } })
  if (!prefs?.simpleProviderConfigId || !prefs?.simpleModel) return null
  const config = await loadUserProviderConfig(userId, prefs.simpleProviderConfigId)
  if (!config) return null
  const provider = config.provider as ProviderType
  return {
    provider,
    model: prefs.simpleModel,
    apiKey: config.apiKey,
    baseURL: config.baseURL || DEFAULT_BASE_URLS[provider] || '',
  }
}

const trimTo = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  return s.length > limit ? s.slice(0, limit) : s
}

/**
 * 模型单项输出 → 候选字段(校验 + 置空 + notes)。
 * 任何被丢弃的字段都记入 notes 并下调置信度,便于客户端展示与排查。
 */
export function sanitizeSmsAiItem(
  raw: Record<string, unknown>,
  item: SmsAiExtractItem,
): SmsAiExtractCandidate {
  const notes: string[] = []

  const amountRaw = raw.amount
  let amount: number | null = null
  if (amountRaw != null) {
    const n = Math.abs(Number(amountRaw))
    // 金额必须有限且落在合理量级:短信金额不存在 0 或 10 亿以上(明显是模型算出来的或读错行)
    if (!Number.isFinite(n) || n <= 0 || n >= 1e9) {
      notes.push('金额不可信已置空')
    } else {
      amount = Math.round(n * 100) / 100
    }
  }

  const isTransaction = raw.isTransaction !== false && amount != null
  if (raw.isTransaction !== false && amount == null) notes.push('缺少可用的交易金额')

  const typeRaw = typeof raw.type === 'string' ? raw.type.trim() : ''
  let type: SmsAiExtractCandidate['type'] = null
  if (typeRaw) {
    if (isRecordType(typeRaw)) type = typeRaw
    else notes.push(`方向不在枚举内已置空(${typeRaw.slice(0, 12)})`)
  }

  let date: string | null = null
  if (typeof raw.date === 'string' && raw.date.trim()) {
    const d = new Date(raw.date.trim())
    if (isNaN(d.getTime())) notes.push('时间无法解析已置空')
    else date = d.toISOString()
  }

  const cardTailRaw = trimTo(raw.cardTail, 8)
  let cardTail: string | null = null
  if (cardTailRaw) {
    if (/^\d{4}$/.test(cardTailRaw)) cardTail = cardTailRaw
    else notes.push('卡尾号不是 4 位数字已置空')
  }

  const confidenceRaw = Number(raw.confidence)
  let confidence = Number.isFinite(confidenceRaw) ? Math.min(0.95, Math.max(0.2, confidenceRaw)) : 0.5
  // 每丢一个字段下调 0.1:被校验削过的结果不该保持高置信度
  confidence = Math.min(0.95, Math.max(0.2, Math.round((confidence - notes.length * 0.1) * 100) / 100))

  return {
    sourceId: item.sourceId,
    isTransaction,
    date,
    amount,
    type,
    bankName: trimTo(raw.bankName, FIELD_LIMITS.bankName),
    cardTail,
    tradeKind: trimTo(raw.tradeKind, FIELD_LIMITS.tradeKind),
    payer: trimTo(raw.payer, FIELD_LIMITS.payer),
    remark: trimTo(raw.remark, FIELD_LIMITS.remark),
    confidence,
    notes,
  }
}

/** 从模型文本里抠出 JSON 数组(容忍 ```json 包裹与前后说明文字) */
function parseJsonArray(text: string): Record<string, unknown>[] | null {
  const body = text.replace(/```(?:json)?/gi, '').trim()
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null
  } catch {
    return null
  }
}

export interface SmsExtractResult {
  candidates: SmsAiExtractCandidate[]
  /** 批次级失败原因(整批网络/解析失败);单条字段问题在 candidate.notes 里 */
  errors: string[]
}

/**
 * 批量抽取。按 SMS_AI_BATCH_SIZE 分批,单批失败不影响其它批(失败批的原文留在客户端,等下次重试)。
 * 未配置模型时抛错,由路由转成 400 文案。
 */
export async function extractSmsItems(
  userId: string,
  items: SmsAiExtractItem[],
): Promise<SmsExtractResult> {
  const candidates: SmsAiExtractCandidate[] = []
  const errors: string[] = []
  if (items.length === 0) return { candidates, errors }

  const config = await loadExtractConfig(userId)
  if (!config) throw new Error('尚未配置 AI 模型,请先到设置 → AI 助手 里选择模型')

  const model = createModel(config.provider, config.model, { apiKey: config.apiKey, baseURL: config.baseURL })

  for (let offset = 0; offset < items.length; offset += SMS_AI_BATCH_SIZE) {
    const batch = items.slice(offset, offset + SMS_AI_BATCH_SIZE)
    const payload = batch.map((item, i) => ({
      i: i + 1,
      sender: item.sender,
      receivedAt: item.receivedAt,
      text: truncateSmsAiText(item.text, SMS_AI_MAX_TEXT_LENGTH),
    }))

    try {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        temperature: 0,
        maxOutputTokens: 4000,
      })

      const rows = parseJsonArray(result.text)
      if (!rows) {
        errors.push(`第 ${Math.floor(offset / SMS_AI_BATCH_SIZE) + 1} 批:模型返回的不是合法 JSON`)
        continue
      }

      // 按 i 回填(模型可能少给/乱序:以输入项为准,缺失的跳过而不是错位)
      for (let i = 0; i < batch.length; i++) {
        const row = rows.find((r) => Number(r.i) === i + 1)
        if (!row) continue
        candidates.push(sanitizeSmsAiItem(row, batch[i]))
      }
    } catch (e: unknown) {
      errors.push(`第 ${Math.floor(offset / SMS_AI_BATCH_SIZE) + 1} 批解析失败:${(e as Error)?.message || '未知错误'}`)
    }
  }

  return { candidates, errors }
}
