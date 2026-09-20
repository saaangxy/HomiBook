import {
  applySmsFilterRules,
  bankNameFromSender,
  buildSmsDedupeKey,
  normalizeEpochMs,
  parseTransactionSms,
  screenSms,
  SMS_AI_MAX_ITEMS,
  SMS_FETCH_MAX,
  type SmsAiExtractItem,
  type SmsFilterRules,
  type SmsTransactionCandidate,
} from '@homibook/core';
import { http } from './http';
import { getPendingNotifications, listSms, type NativeSmsRecord } from './txn-reader';
import { getSmsFilterRules, loadSmsFilterRules } from './sms-rules';
import type { ImportPreviewResult } from './import';

// 短信记账:本机采集(短信 + 银行/支付通知)→ 预筛/解析(core 纯函数)→ 同笔折叠
// → 提交后端「解析后」管线做账户匹配与分类映射。
// 隐私:默认只上送结构化字段,不上送原始正文;通知渠道也只读白名单来源(见原生模块)。

/** 默认扫描区间(天) */
export const SMS_SCAN_DAYS_DEFAULT = 30;

/** 「需确认」的置信度门槛(与核心注释里的自动记账门槛同一口径:低于它一律要求人工确认) */
export const SMS_LOW_CONFIDENCE = 0.8;

/**
 * 单次向系统短信库查询的条数上限(原生模块的硬上限也是 2000)。
 * 为什么必须分段:provider 查询必须带 limit,而长时间区间远超这个数 ——
 * 实测 3000 天区间里光一家银行就有上千条,「只取最新 N 条」会把老短信整段漏掉。
 */
const SMS_QUERY_LIMIT = 2000;
/** 分段大小(天):段越小越不容易撞上单段上限,代价是多几次本机查询 */
const SMS_QUERY_SEGMENT_DAYS = 90;
// 读取总量上限由 core 定义(SMS_FETCH_MAX):服务端预览的候选上限与它同源 ——
// 两边各写一个数字的话,客户端读得比服务端愿意收的多,预览就会被 400 挡掉
export { SMS_FETCH_MAX };

/**
 * 需人工确认:置信度偏低 / 方向未识别 / 账户没匹配上(本地与服务端都没给出账户名)。
 * 扫描页据此把这类行排除在**默认勾选**之外(想导入再手动勾),详情页据此标红。
 * 疑似重复不在其中 —— 它有自己的判定与提示。
 */
export function needsConfirm(
  candidate: { confidence: number; type: string; accountName: string | null },
  previewRow?: { accountName?: string | null },
): boolean {
  if (candidate.confidence < SMS_LOW_CONFIDENCE) return true;
  if (candidate.type === 'UNKNOWN') return true;
  if (!(previewRow?.accountName || candidate.accountName)) return true;
  return false;
}

/**
 * 服务号发件人:106 聚合号段 / 95xxx 银行客服 / 100xx 运营商短号。
 * 小米 / 红米(HyperOS)把这类「通知类短信」单独管控:未允许时应用只看得到个人短信 ——
 * 本机库里一条服务号都没有,基本就是这个原因(应用无法查询该权限,只能这样间接判断)。
 */
const SERVICE_SENDER_RE = /^(?:\+?86)?(?:106\d{5,}|95\d{3}|1\d{4})$/;

/** 发件人是否为服务号(供「通知类短信」未允许的症状提示) */
function isServiceSender(address: string | null): boolean {
  const s = (address ?? '').trim();
  return s.length > 0 && SERVICE_SENDER_RE.test(s);
}

/** 数据来源渠道 */
export type SmsChannel = 'sms' | 'notification';

/** 本机候选:core 解析结果 + 折叠键 + 来源渠道 */
export interface SmsCandidate extends SmsTransactionCandidate {
  dedupeKey: string;
  channel: SmsChannel;
  /**
   * 同一笔被折叠掉的其它来源(渠道 + 来源 id)。
   * 导入时要把它们**一并**标记「已处理」并从通知队列移除 —— 只标记保留的那条,
   * 另一渠道的副本下次扫描会以「疑似重复」再出现一次。
   */
  mergedSources?: { id: string; channel: SmsChannel }[];
}

/** 扫描时见到的来源(发件号码 / 通知来源):给「筛选规则 → 发件人白名单」当候选列表 */
export interface SmsSenderStat {
  /** 匹配标识:短信=发件号码,通知=来源展示名(与规则里的 sender 口径一致) */
  sender: string;
  channel: SmsChannel;
  /** 展示用补充:短信=服务号推断出的机构名,通知=来源包名 */
  detail: string | null;
  /** 见到的原始条数 */
  count: number;
  /** 其中被识别为交易的条数 */
  transactions: number;
}

export interface SmsScanResult {
  /** 待导入候选(已折叠同笔,新的在前) */
  candidates: SmsCandidate[];
  /**
   * 本地没读懂、但通过了用户筛选规则的原文(新的在前,上限 SMS_AI_MAX_ITEMS)。
   * 只在用户开启「AI 兜底解析」时才会被上送;关闭时派不上用场,也不会离开本机。
   */
  unrecognized: SmsAiExtractItem[];
  /** 落在时间窗内、参与解析的原始条数(短信 + 通知) */
  scanned: number;
  /**
   * 本机短信库里是否见到过服务号(106 / 95xxx / 100xx)发件人。
   * 小米 / 红米把这类短信划为「通知类短信」,未允许时应用只能看到个人短信;
   * 据此在扫描页提示用户去系统权限里开启(该权限无法查询,只能靠症状判断)。仅短信渠道有意义。
   */
  hasServiceSender: boolean;
  /** 本次读取是否撞到总量上限(SMS_FETCH_MAX):撞到时更早的短信没纳入,提示用户缩小时间范围 */
  fetchLimitHit: boolean;
  /** 预筛命中「交易」的条数(折叠前) */
  matched: number;
  /** 同一笔被折叠掉的条数(短信与通知双渠道上报同一笔) */
  duplicates: number;
  /** 去重第 1 层:因「已处理」标记跳过的条数 */
  skippedProcessed: number;
  /** 用户筛选规则拦掉的条数(通道/发件人/关键词/金额下限) */
  skippedByRules: number;
  /**
   * 本次扫描见到的来源(发件号码 / 通知来源,含被规则拦下的)。
   * 客户端把它合并进本机缓存,作为筛选规则里「发件人白名单」的下拉候选。
   */
  senders: SmsSenderStat[];
  /** 各渠道命中数(折叠前),供 UI 说明「通知仅能捕获开启权限之后」 */
  channels: { sms: number; notification: number };
  /**
   * 本机通知队列的条数(不一定命中「交易」)。
   * 「队列 0 条」与「队列 N 条都不像交易」是完全不同的排查方向,所以要分开报出来。
   */
  notificationQueued: number;
}

export interface ScanOptions {
  days?: number;
  /** 短信读取总量上限(默认 SMS_FETCH_MAX,且不超过它) */
  limit?: number;
  accountBookId?: string | null;
  now?: Date;
  /** 本机「已处理」标记(去重第 1 层) */
  processedIds?: Set<string>;
  /** 用户筛选规则(缺省时从本机存储读取) */
  rules?: SmsFilterRules;
}

interface Collected {
  list: SmsCandidate[];
  unrecognized: SmsAiExtractItem[];
  senders: SmsSenderStat[];
  scanned: number;
  /** 短信渠道:库里是否见到服务号发件人(通知渠道恒为 false) */
  hasServiceSender: boolean;
  /** 是否撞到读取总量上限(通知渠道恒为 false) */
  fetchLimitHit: boolean;
  /** 本机通知队列条数(仅通知渠道有意义,短信渠道恒为 0) */
  notificationQueued: number;
  matched: number;
  skippedProcessed: number;
  skippedByRules: number;
}

/**
 * 来源统计:每条内容记一次 seen,被识别为交易时再记一次 txn。
 * 没有发件人的内容不进统计(无法加白名单)。
 */
function bumpSender(
  acc: Map<string, SmsSenderStat>,
  input: { sender: string | null | undefined; channel: SmsChannel; detail?: string | null; kind?: 'seen' | 'txn' },
): void {
  const sender = (input.sender ?? '').trim();
  if (!sender) return;
  const key = `${input.channel}|${sender}`;
  const entry = acc.get(key) ?? {
    sender, channel: input.channel, detail: input.detail ?? null, count: 0, transactions: 0,
  };
  if (input.kind === 'txn') entry.transactions++;
  else entry.count++;
  if (!entry.detail && input.detail) entry.detail = input.detail;
  acc.set(key, entry);
}

/** 合并两个渠道的来源统计(同一来源跨渠道分别计数) */
function mergeSenderStats(...groups: SmsSenderStat[][]): SmsSenderStat[] {
  const acc = new Map<string, SmsSenderStat>();
  for (const group of groups) {
    for (const stat of group) {
      const key = `${stat.channel}|${stat.sender}`;
      const prev = acc.get(key);
      if (prev) {
        prev.count += stat.count;
        prev.transactions += stat.transactions;
        if (!prev.detail && stat.detail) prev.detail = stat.detail;
      } else {
        acc.set(key, { ...stat });
      }
    }
  }
  return [...acc.values()].sort((a, b) => b.count - a.count);
}

/**
 * 按时间窗分段读取短信库(新的在前)。
 * selection 只用最简单的 date 列比较:实测部分 ROM/Android 16 的 provider 对 selection / sortOrder
 * 里的 SQL 表达式会**静默返回 0 行**,简单列比较才可靠(详见原生模块注释)。
 */
async function fetchSmsInWindow(start: number, end: number, cap: number): Promise<NativeSmsRecord[]> {
  const rows: NativeSmsRecord[] = [];
  const seen = new Set<string>();
  const segmentMs = SMS_QUERY_SEGMENT_DAYS * 86_400_000;
  // 从最新一段往回走:即使撞上总量上限,丢的是更早的历史,而不是最近要记的账
  for (let segEnd = end; segEnd > start; segEnd -= segmentMs) {
    const segStart = Math.max(start, segEnd - segmentMs);
    const chunk = await listSms({ start: segStart, end: segEnd, limit: SMS_QUERY_LIMIT });
    for (const row of chunk) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length >= cap) break;
  }
  return rows;
}

/** 短信渠道:只读收件箱,预筛 + 解析全在本机完成 */
async function collectSms(opts: ScanOptions): Promise<Collected> {
  const days = opts.days ?? SMS_SCAN_DAYS_DEFAULT;
  const now = opts.now ?? new Date();
  const start = now.getTime() - days * 86_400_000;
  const end = now.getTime();
  // 按时间窗分段取数(查询本身已带 date 区间,用简单列比较)。
  // 单位归一化必须留在 JS:库里若有「date 被写成秒」的行,SQL 的毫秒比较会把它排除在外。
  const cap = Math.min(opts.limit ?? SMS_FETCH_MAX, SMS_FETCH_MAX);
  const fetched = await fetchSmsInWindow(start, end, cap);
  const smsList = fetched
    .map((row) => ({ ...row, date: normalizeEpochMs(row.date) }))
    .filter((row) => row.date >= start && row.date <= end);

  const list: SmsCandidate[] = [];
  const unrecognized: SmsAiExtractItem[] = [];
  const senders = new Map<string, SmsSenderStat>();
  let matched = 0;
  let skippedProcessed = 0;
  let skippedByRules = 0;
  const rules = opts.rules ?? getSmsFilterRules();

  for (const sms of smsList) {
    // 来源统计(含被规则拦下的内容):给筛选规则的发件人下拉当候选
    bumpSender(senders, { sender: sms.address, channel: 'sms', detail: bankNameFromSender(sms.address) });

    // 第一层:用户规则(通道 / 发件人 / 关键词)。它同时是隐私闸门 —— 被拦下的内容不会进候选,也不会被送到 AI
    const verdict = applySmsFilterRules({ channel: 'sms', text: sms.body, sender: sms.address, rules });
    if (!verdict.pass) {
      skippedByRules++;
      continue;
    }

    const screen = screenSms(sms.body);
    if (!screen.isTransaction) {
      // 内置排除项(验证码/账单提醒/营销/优惠)确定不是交易,不占用 AI 额度;
      // 其余「缺交易字眼 / 读不出金额」正是长尾格式,留给 AI 兜底
      if (!screen.reason.startsWith('exclude:') && screen.reason !== 'empty') {
        unrecognized.push({
          sourceId: sms.id, text: sms.body, sender: sms.address,
          receivedAt: new Date(sms.date).toISOString(), channel: 'sms',
        });
      }
      continue;
    }

    const parsed = parseTransactionSms({
      text: sms.body,
      sender: sms.address,
      sourceId: sms.id,
      receivedAt: sms.date,
      now,
    });
    if (!parsed) {
      unrecognized.push({
        sourceId: sms.id, text: sms.body, sender: sms.address,
        receivedAt: new Date(sms.date).toISOString(), channel: 'sms',
      });
      continue;
    }
    matched++;
    bumpSender(senders, { sender: sms.address, channel: 'sms', kind: 'txn' });

    // 第二层:拿到金额后再过一遍金额下限(读不出金额的内容不参与该判定)
    const amountVerdict = applySmsFilterRules({ channel: 'sms', text: sms.body, sender: sms.address, amount: parsed.amount, rules });
    if (!amountVerdict.pass) {
      skippedByRules++;
      continue;
    }

    if (opts.processedIds?.has(sms.id)) {
      skippedProcessed++;
      continue;
    }
    list.push({ ...parsed, channel: 'sms', dedupeKey: buildSmsDedupeKey(parsed, opts.accountBookId) });
  }

  return {
    list, unrecognized, senders: [...senders.values()],
    scanned: smsList.length,
    hasServiceSender: fetched.some((row) => isServiceSender(row.address)),
    fetchLimitHit: fetched.length >= cap,
    notificationQueued: 0,
    matched, skippedProcessed, skippedByRules,
  };
}

/**
 * 通知渠道:读本机累积队列(白名单来源 + 金额线索已在原生侧粗筛)。
 * 通知往往把账户写在标题、金额写在正文,故拼接后再解析;来源名用作银行名兜底。
 */
async function collectNotifications(opts: ScanOptions): Promise<Collected> {
  const days = opts.days ?? SMS_SCAN_DAYS_DEFAULT;
  const now = opts.now ?? new Date();
  const from = now.getTime() - days * 86_400_000;

  const notifications = await getPendingNotifications();
  const list: SmsCandidate[] = [];
  const unrecognized: SmsAiExtractItem[] = [];
  const senders = new Map<string, SmsSenderStat>();
  let matched = 0;
  let skippedProcessed = 0;
  let skippedByRules = 0;
  const rules = opts.rules ?? getSmsFilterRules();

  for (const n of notifications) {
    if (n.postedAt < from || n.postedAt > now.getTime()) continue;
    const text = [n.title, n.text].filter(Boolean).join(' ');
    // 来源统计:通知的 sender 用来源展示名(与规则口径一致),包名作展示补充
    bumpSender(senders, { sender: n.source, channel: 'notification', detail: n.pkg });

    const verdict = applySmsFilterRules({ channel: 'notification', text, sender: n.source, rules });
    if (!verdict.pass) {
      skippedByRules++;
      continue;
    }

    const screen = screenSms(text);
    if (!screen.isTransaction) {
      if (!screen.reason.startsWith('exclude:') && screen.reason !== 'empty') {
        unrecognized.push({
          sourceId: n.key, text, sender: n.source,
          receivedAt: new Date(n.postedAt).toISOString(), channel: 'notification',
        });
      }
      continue;
    }

    const parsed = parseTransactionSms({
      text,
      sender: n.source,
      sourceId: n.key,
      receivedAt: n.postedAt,
      now,
      // 通知没有【银行】前缀:用白名单里的来源名兜底机构名,备注前缀也标成「通知」
      channel: 'notification',
      bankNameFallback: n.source,
    });
    if (!parsed) {
      unrecognized.push({
        sourceId: n.key, text, sender: n.source,
        receivedAt: new Date(n.postedAt).toISOString(), channel: 'notification',
      });
      continue;
    }
    matched++;
    bumpSender(senders, { sender: n.source, channel: 'notification', kind: 'txn' });

    const amountVerdict = applySmsFilterRules({ channel: 'notification', text, sender: n.source, amount: parsed.amount, rules });
    if (!amountVerdict.pass) {
      skippedByRules++;
      continue;
    }

    if (opts.processedIds?.has(n.key)) {
      skippedProcessed++;
      continue;
    }

    // 机构名/账户名已在解析时用 bankNameFallback 兜底,这里只补渠道标记
    const candidate = { ...parsed, channel: 'notification' as const } as SmsCandidate;
    candidate.dedupeKey = buildSmsDedupeKey(candidate, opts.accountBookId);
    list.push(candidate);
  }

  return {
    list, unrecognized, senders: [...senders.values()],
    scanned: notifications.length,
    // 「通知类短信」判定与读取上限只看短信库,通知渠道不参与
    hasServiceSender: false,
    fetchLimitHit: false,
    notificationQueued: notifications.length,
    matched, skippedProcessed, skippedByRules,
  };
}

/**
 * 同笔折叠:短信与通知双渠道上报同一笔时只留一条(保留置信度更高的),
 * 并把被折叠掉的来源记进 `mergedSources` —— 导入时它们要一起标记「已处理」并从通知队列移除。
 */
function foldCandidates(list: SmsCandidate[]): { candidates: SmsCandidate[]; duplicates: number } {
  const byKey = new Map<string, SmsCandidate>();
  const union = (a: { id: string; channel: SmsChannel }[], b: { id: string; channel: SmsChannel }[]) =>
    [...new Map([...a, ...b].map((s) => [s.id, s])).values()];

  let duplicates = 0;
  for (const c of list) {
    const prev = byKey.get(c.dedupeKey);
    if (!prev) {
      byKey.set(c.dedupeKey, c);
      continue;
    }
    duplicates++;
    const winner = prev.confidence >= c.confidence ? prev : c;
    const loser = winner === prev ? c : prev;
    byKey.set(c.dedupeKey, {
      ...winner,
      mergedSources: union(
        winner.mergedSources ?? [],
        [{ id: loser.sourceId, channel: loser.channel }, ...(loser.mergedSources ?? [])],
      ),
    });
  }
  const candidates = [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { candidates, duplicates };
}

/**
 * 扫描本机短信与通知并产出候选(新的在前)。
 * 全程不联网;是否交易、字段提取、同笔折叠都在本机完成。
 */
export async function scanCandidates(opts: ScanOptions = {}): Promise<SmsScanResult> {
  // 规则只读一次(本机存储),再传给两个采集器,避免每条短信都读一次
  const rules = opts.rules ?? (await loadSmsFilterRules());
  const scanOpts: ScanOptions = { ...opts, rules };
  const [sms, notification] = await Promise.all([collectSms(scanOpts), collectNotifications(scanOpts)]);
  const { candidates, duplicates } = foldCandidates([...sms.list, ...notification.list]);

  // 未识别原文:按来源去重、新的在前、封顶 SMS_AI_MAX_ITEMS(同时控制隐私面与 token 成本)
  const unrecognized: SmsAiExtractItem[] = [];
  const seen = new Set<string>();
  const merged = [...sms.unrecognized, ...notification.unrecognized].sort((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt),
  );
  for (const item of merged) {
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    unrecognized.push(item);
    if (unrecognized.length >= SMS_AI_MAX_ITEMS) break;
  }

  const skippedByRules = sms.skippedByRules + notification.skippedByRules;
  const senders = mergeSenderStats(sms.senders, notification.senders);

  return {
    candidates,
    unrecognized,
    senders,
    scanned: sms.scanned + notification.scanned,
    hasServiceSender: sms.hasServiceSender,
    fetchLimitHit: sms.fetchLimitHit,
    notificationQueued: notification.notificationQueued,
    matched: sms.matched + notification.matched,
    duplicates,
    skippedProcessed: sms.skippedProcessed + notification.skippedProcessed,
    skippedByRules,
    channels: { sms: sms.matched, notification: notification.matched },
  };
}

/**
 * 候选 → 后端预览(账户匹配 + 分类映射 + 弱校验)。
 * 返回结构与文件导入的预览完全一致 → 可直接交给 ImportSheet 复用预览/确认 UI。
 */
export function smsPreview(accountBookId: string, candidates: SmsCandidate[]): Promise<ImportPreviewResult> {
  return http.post<ImportPreviewResult>('/api/sms/preview', {
    accountBookId,
    candidates: candidates.map((c) => ({
      sourceId: c.sourceId,
      date: c.date,
      type: c.type,
      amount: c.amount,
      payer: c.payer,
      remark: c.remark,
      tradeKind: c.tradeKind,
      bankName: c.bankName,
      cardTail: c.cardTail,
      accountName: c.accountName,
      // 原文 raw 刻意不上送(隐私默认值)
    })),
  });
}
