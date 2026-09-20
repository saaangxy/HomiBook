/**
 * 短信 / 银行通知记账 —— 交易短信预筛与解析(纯 TS,三端共享)。
 *
 * 职责边界:只回答「这条文本是不是一笔交易」并把关键字段粗提取出来。
 * **不做**账户匹配、分类映射、去重落库 —— 那些复用导入管线「解析成结构化数据之后」的阶段
 * (结构化候选 → 解析后公共管线),短信路径不产生任何文件。
 *
 * 低置信度不猜测:金额/方向取不到就返回 null 或降置信度交给人工确认,
 * 不在解析层做静默归一化(与工具入参校验同一原则)。
 */
import type { RecordType } from './types/index.js';

// ── 批量上限 ──
// 客户端与服务端必须**同源**:客户端读得比服务端愿意收的多,预览/导入就会在中间被挡掉。

/** 单次扫描最多从系统短信库读取的条数(移动端分段取数的总量上限);撞到它时扫描页提示缩小时间范围 */
export const SMS_FETCH_MAX = 5000;

/**
 * 单次「短信候选预览」允许的条数上限。
 * = 读取上限 + AI 兜底可能新增的余量(未识别原文 ≤ SMS_AI_MAX_ITEMS),把两者都算进来才不会被挡。
 * 服务端 preview 的 maxItems 用它;客户端的读取上限用 SMS_FETCH_MAX。
 */
export const SMS_CANDIDATE_MAX = SMS_FETCH_MAX + 1000;

// ── 预筛规则 ──

/** 命中即排除。验证码类文本也含数字与「交易」字眼,必须先排除再取金额 */
const EXCLUDE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: '验证码', re: /验证码|校验码|动态密码|动态码|短信密码|验证身份/ },
  // 账单提醒:提醒「该还了 / 待还」,钱还没动 —— 真正的还款会另有一条流水,收进来等于提前记 + 重复记
  // (实测:美团月付「您8月账单27.56元待还，最后还款日为8月22号，查账或立即还款点击 …」)
  // 「最后还款日 / 立即还款 / 元待还 / 待还金额」都是提醒措辞,已发生的还款流水不会这么写
  { name: '账单提醒', re: /账单提醒|还款提醒|账单已生成|即将到期|到期日|本期账单|额度提醒|最后还款日|立即还款|元待还|待还金额/ },
  // 「请及时还款」单看太宽:花呗 / 信用卡的**支付成功**通知末尾也常带这句,会把真实支出误杀
  // (实测:支付宝「你有一笔179.51元的支出，点击查看详情。使用花呗支付。请及时还款。」被判成账单提醒)
  // 所以要求它同时出现在「账单 / 应还 / 待还」语境里 —— 用前瞻断言限定,不改变排除顺序
  { name: '账单提醒', re: /(?=[\s\S]*(?:账单|应还|待还|还款日|最低还款))[\s\S]*请及时还款/ },
  // 账单汇总(话费/信用卡/宽带):金额是「本期共消费」的汇总,常带分项描述,不是一笔流水
  // (实测:移动话费账单「共消费8.10元 + 套餐及固定费8.00元」会被当成一笔 8.10 元支出)
  // 刻意不收「账单详情 / 账单」这类通用词:银行交易短信的页脚也常这么写(「账单详情见掌上生活」),
  // 收了会把真实流水一起误杀;只认银行/运营商账单特有的分项与汇总措辞
  { name: '账单汇总', re: /话费账单|消费项目|套餐及固定费|共消费|账单已出|消费合计|当月消费|套餐余量|已用[^。；]{0,10}剩余/ },
  // 余额 / 额度 / 停机类服务提醒:夹带的「可透支100元」会被金额规则当成流水
  // (实测:移动「话费余额已不足…可透支100元…将停机」会被当成一笔 100 元支出)
  { name: '余额额度提醒', re: /余额已不足|可透支|透支额度|将停机|及时充值|忽略本提醒/ },
  // 运营商/支付渠道的充值到账提醒:是服务通知而非银行流水。它含「到账」(交易字眼)与「100.00元」(金额),
  // 不排除会被当成一笔收入(实测:移动「【充值到账提醒】…为您成功充值100.00元…」)。
  // 而且同一笔话费在支付渠道通常另有一条流水,收进来等于重复记账。
  { name: '充值提醒', re: /充值到账提醒|成功充值|充值成功|为您充值|充值服务|话费充值|充值[^。；]{0,12}已到账/ },
  // 押金解冻 / 资金冻结:是资金「状态」变化,不是收支
  // (实测:神州租车「订单押金5000.00元，已解冻3000.00元…3-5个工作日到账」)
  // 注意「支付押金」本身不在此列:实付是真实资金流出,该记支出,退还/解冻时才排除
  { name: '资金冻结解冻', re: /解冻|冻结/ },
  // 「拒收请回复R」是 106 营销短信的另一种标准页脚(不是常见的「退订回T」),少了它整条会漏筛
  { name: '营销推广', re: /退订|回[TNtn]退订|拒收请?回复|拒收回复|详情点击|点击链接|点击参与/ },
  { name: '优惠权益', re: /优惠券|积分兑换|抽奖|领取.{0,4}(?:优惠|权益|红包)|代金券|现金券|餐券|权益到账|已获得[^。；]{0,10}权益/ },
  // 促销话术:这类短信常同时带「消费」「立减」与金额,不排除会被当成一笔支出
  // (实测:建行「限时优惠！月月领红包，最高8.88元立减金，消费直抵！…数量有限，先到先得…拒收请回复R」
  //  被判成一笔 8.88 元消费)。只收促销特有词,**刻意不认「点击 / 查看」**——
  // 真实动账短信的页脚也常写「点击查看>>」(见测试 CCB_ALERT),收了会把真流水误杀。
  { name: '促销话术', re: /限时优惠|立减金|先到先得|抢完即止|数量有限|月月领|领红包|红包雨|满\d+减\d+/ },
];

/** 必须命中其一:交易字眼 */
const TRANSACTION_KEYWORDS =
  /交易|支出|收入|消费|转支|转存|转出|转入|转账|扣款|扣费|入账|到账|存入|支取|取现|付款|收款|退款|还款|代扣|工资|利息|结算/;

/** 金额锚点(按可信度从高到低;裸金额兜底会继续降置信度) */
const AMOUNT_CURRENCY_RE = /(?:人民币|RMB|￥|¥)\s*([+-]?\d[\d,]*(?:\.\d{1,2})?)/;
const AMOUNT_YUAN_RE = /([+-]?\d[\d,]*(?:\.\d{1,2})?)\s*元/;
const AMOUNT_PLAIN_RE = /([+-]?\d[\d,]*\.\d{2})/;

/** 余额段:取交易金额前先剔除,否则「余额611.92」会被当成交易金额 */
const BALANCE_RE = /(?:可用余额|账户余额|余额)(?:为|是)?\s*[:：]?\s*([\d,]+\.\d{2})/;

/** 方向关键词(金额带符号时以符号为准) */
const INCOME_WORDS = /转入|转存|存入|入账|到账|收入|收款|退款|退货|工资|利息|返现|红包|报销/;
// 「支付」必须在内:预付/退还类短信常写「应退…3-5个工作日到账」,少了它方向会被「到账」判成收入
const EXPENSE_WORDS = /转支|转出|支出|消费|扣款|扣费|付款|支付|代扣|取现|支取|还款|缴纳|缴费|手续费/;

/**
 * 交易类型原文(供分类映射参考)。
 * 末尾的「收入 / 支出」是兜底口径:不少通知只写方向不写业务类型(「收入人民币1.00元」),
 * 分类映射拿不到源分类就只能人工选;把方向词也作为源分类,映射表就有了可命中的键。
 * 顺序要紧:具体业务类型(转支/消费/代扣…)写在前面,先命中先取。
 */
const TRADE_KIND_RE = /(转支|转存|转账|消费|取现|支取|存款|存入|付款|收款|退款|还款|代扣|缴费|利息|工资|红包|收入|支出)/;

/** 银行/机构名:【xx银行】方括号前缀(支付宝/微信等支付渠道同样适用) */
const BANK_BRACKET_RE = /【([^】]{2,20})】/;
const BANK_NAME_RE = /银行|信用社|农商|银联|邮政储蓄|支付宝|微信|财付通|京东/;

/**
 * 银行客服号 → 银行名。
 * 不少短信没有【银行】前缀(尤其代扣/动账通知类),正文里只有卡尾号;此时发件服务号是唯一可靠的机构线索,
 * 缺了它账户名只能取到「尾号9671」,账户匹配必然失败(表现为列表里一片「未识别账户」)。
 * 只收录确定的一对一服务号;106 聚合号段在下方按「包含服务号」匹配(如 106980095599 → 95599)。
 */
const SMS_SENDER_BANKS: Record<string, string> = {
  '95599': '中国农业银行',
  '95588': '中国工商银行',
  '95533': '中国建设银行',
  '95566': '中国银行',
  '95559': '交通银行',
  '95580': '中国邮政储蓄银行',
  '95555': '招商银行',
  '95558': '中信银行',
  '95595': '光大银行',
  '95568': '中国民生银行',
  '95561': '兴业银行',
  '95528': '浦发银行',
  '95508': '广发银行',
  '95577': '华夏银行',
  '95511': '平安银行',
};

/**
 * 发件号码 → 银行名(导出供「筛选规则的发件人候选列表」显示友好标签,与解析共用同一张服务号表)。
 * 精确服务号优先,其次 106 聚合号段里包含的服务号。
 */
export function bankNameFromSender(sender: string | null): string | null {
  if (!sender) return null;
  const s = sender.trim();
  if (!s) return null;
  const direct = SMS_SENDER_BANKS[s];
  if (direct) return direct;
  const embedded = /(95\d{3})/.exec(s);
  return embedded ? SMS_SENDER_BANKS[embedded[1]] ?? null : null;
}

const CARD_TAIL_RES = [
  // 「为 / 是」要可选:农行短信与 App 通知都写「尾号为5172」,少了这一层尾号整条会丢 →
  // 账户名退化成「中国农业银行」(无尾号)→ 账户匹配失败,落进「未识别账户」
  /(?:尾号|卡号末|末四位|末位|尾数)(?:为|是)?\s*(\d{3,4})/,
  // 掩码卡号:账户****5172 / 卡号**5678
  /[*＊]{2,}\s*(\d{4})/,
];

/**
 * 花括号补充说明:工商银行等用「{他行汇入}」标注资金来源/渠道。
 * 它不是交易对手,单独保留进备注(避免这类信息在入库时整条丢失)。
 */
const DETAIL_BRACE_RE = /[{｛]([^}｝]{2,20})[}｝]/;

/** 交易方:按银行短信常见句式依次尝试 */
const COUNTERPARTY_RES = [
  /向\s*(.{1,30}?)\s*(?:完成|转账|付款|支付|汇出)/,
  /(?:收款方|对方|交易对方|商户|付款方)\s*[:：]?\s*(.{1,30}?)(?:[，,。；;]|$)/,
  /由\s*(.{1,30}?)\s*(?:完成|转入|存入)/,
];

// ── 时间规则 ──

/**
 * 时分片段:两种常见写法 —— 数字(HH:mm[:ss])与中文(HH时MM分 / HH点MM分)。
 * 银行/支付通知大量使用中文写法(如「6月14日15时32分」),只认冒号会把时间退化成当天正午。
 * 抽成片段拼进两个日期正则,避免同一套规则写两遍。
 * 组序:1=时, 2=分(冒号式), 3=秒(可空), 4=分(中文式)
 */
const TIME_HM = '(\\d{1,2})\\s*(?:[:：]\\s*(\\d{2})(?::(\\d{2}))?|(?:时|点)\\s*(\\d{1,2})\\s*分?)';
const DATETIME_FULL_RE = new RegExp(
  `(\\d{4})\\s*[-/年]\\s*(\\d{1,2})\\s*[-/月]\\s*(\\d{1,2})\\s*日?\\s*${TIME_HM}`,
);
const DATETIME_MD_RE = new RegExp(`(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日\\s*${TIME_HM}`);
const DATE_FULL_RE = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/;
const DATE_MD_RE = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;

/** 从 TIME_HM 的捕获组里取分钟:冒号式(组 2)优先,其次中文式(组 4),都没有按 0 */
function minuteOf(colonMinute: string | undefined, chineseMinute: string | undefined): number {
  return Number(colonMinute ?? chineseMinute ?? 0);
}

/** 账单时区(与导入管线一致:银行短信时间按 +08:00 墙上时间解析) */
const BEIJING_OFFSET_MS = 8 * 3600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 取某时刻的北京时间日历字段(不依赖设备时区) */
function beijingParts(date: Date) {
  const t = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/** 北京墙上时间 → ISO(UTC)。跨年推断基准 = 短信到达时刻(缺失则取 now) */
function buildIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(
    `${pad2(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+08:00`,
  ).toISOString();
}

// ── 类型 ──

/** 预筛结论(附判定原因,便于调试与单测) */
export interface SmsScreenResult {
  isTransaction: boolean;
  /** 命中的规则名:如 'keyword+amount' / 'exclude:验证码' / 'no-amount' */
  reason: string;
}

/** 交易短信解析出的候选流水(账户/分类待「解析后公共管线」决议) */
export interface SmsTransactionCandidate {
  /** 来源消息唯一 id(Android 短信 _id / 通知 key):「已处理」标记用 */
  sourceId: string;
  /** 原始正文(仅在用户开启「上送 AI 分类」时使用,默认不出设备) */
  raw: string;
  /** 发件号码 / 通知包名 */
  sender: string | null;
  bankName: string | null;
  /** 卡尾号:账户匹配的首选依据(账户名里通常带尾号) */
  cardTail: string | null;
  /** 账单时区(+08:00)ISO,与导入管线 parseDateStr 产出一致 */
  date: string;
  /** 恒为正数,方向看 type */
  amount: number;
  /**
   * 收支方向。'UNKNOWN' = 文本层判不出来(本地规则解析的符号/关键词都未命中,或 AI 不敢定):
   * 后端会把它归入「未识别记录」由用户在确认卡里指定方向与账户,不做静默归一化。
   */
  type: RecordType | 'UNKNOWN';
  /** 交易类型原文(转支/消费/…),分类映射的参考输入 */
  tradeKind: string | null;
  /** 交易方 */
  payer: string | null;
  /** 账户名猜测(银行名+尾号):名称包含匹配的兜底,优先仍用 cardTail/bankName 打 accountNo */
  accountName: string | null;
  /** 建议写入流水的备注(摘要,**不含**正文) */
  remark: string;
  /** 余额(可空,仅作参考) */
  balance: number | null;
  /**
   * 解析置信度 0~1。
   * 上限 0.95:账户是否唯一匹配只有服务端知道,文本层不给满分。
   * 自动记账建议门槛:confidence ≥ 0.8 **且** 账户唯一匹配。
   */
  confidence: number;
}

export interface ParseSmsInput {
  text: string;
  /** 发件号码 / 通知来源名 */
  sender?: string | null;
  /**
   * 渠道:只影响备注前缀(通知类文本写着「通知」而不是「短信」,避免入库存成错误的来源描述)。
   * 缺省按短信处理。
   */
  channel?: 'sms' | 'notification';
  /**
   * 机构名兜底:通知没有【银行】前缀、发件人又是应用名时,由调用方传入白名单来源名(如「中国建设银行」)。
   * 传入后会参与机构名/账户名/置信度计算,保证与手工核对结果一致。
   */
  bankNameFallback?: string | null;
  /** 来源消息 id;缺省用 date+金额指纹兜底(保证候选可被「已处理」标记) */
  sourceId?: string;
  /** 短信到达时刻(ms / ISO / Date):补全年份与缺失的时分。缺失则退化为按 now 推断 */
  receivedAt?: number | string | Date;
  /** 「现在」,仅测试与跨年推断用 */
  now?: Date;
}

// ── 预筛 ──

/**
 * 预筛:是否交易短信。纯文本判定(不需要权限/网络),可先对整批短信跑一遍再解析。
 * 顺序要紧:先排除验证码/提醒/营销,再要求「交易字眼 + 金额」同时命中。
 */
export function screenSms(text: string): SmsScreenResult {
  const body = (text || '').trim();
  if (!body) return { isTransaction: false, reason: 'empty' };

  for (const p of EXCLUDE_PATTERNS) {
    if (p.re.test(body)) return { isTransaction: false, reason: `exclude:${p.name}` };
  }
  if (!TRANSACTION_KEYWORDS.test(body)) return { isTransaction: false, reason: 'no-keyword' };

  const amounts = collectAmounts(body);
  if (amounts.length === 0) return { isTransaction: false, reason: 'no-amount' };
  // 三种锚点取到的金额全为 0:「消费金额为0.00元」这类自动续费 / 试用通知不是流水(0 元入账没有意义)。
  // 只在**全部**金额都为 0 时排除,避免「余额0.00元…消费100.00元」这类被误杀
  if (amounts.every((v) => v === 0)) return { isTransaction: false, reason: 'exclude:金额为零' };

  return { isTransaction: true, reason: 'keyword+amount' };
}

/**
 * 按三种金额锚点各取一个值(用于「金额全为 0」判定)。
 * 与 extractAmount 的区别:那个只取最可信的一个,这里要把各锚点的候选都拿出来比较。
 */
function collectAmounts(text: string): number[] {
  const out: number[] = [];
  const currency = AMOUNT_CURRENCY_RE.exec(text);
  if (currency) out.push(toNumber(currency[1]));
  const yuan = AMOUNT_YUAN_RE.exec(text);
  if (yuan) out.push(toNumber(yuan[1]));
  const plain = stripBalance(text).text.match(AMOUNT_PLAIN_RE);
  if (plain) out.push(toNumber(plain[1]));
  return out;
}

// ── 解析 ──

const toNumber = (raw: string): number => Number.parseFloat(raw.replace(/,/g, ''));

/** 剔除余额段:避免「余额611.92」被裸金额正则当成交易金额 */
function stripBalance(text: string): { text: string; balance: number | null } {
  const m = BALANCE_RE.exec(text);
  if (!m) return { text, balance: null };
  return { text: text.slice(0, m.index) + text.slice(m.index + m[0].length), balance: toNumber(m[1]) };
}

/** 取交易金额与锚点可信度;无金额返回 null */
function extractAmount(text: string): { amount: number; signed: boolean; anchor: 'currency' | 'yuan' | 'plain' } | null {
  const currency = AMOUNT_CURRENCY_RE.exec(text);
  if (currency) return { amount: toNumber(currency[1]), signed: /^[+-]/.test(currency[1]), anchor: 'currency' };

  const yuan = AMOUNT_YUAN_RE.exec(text);
  if (yuan) return { amount: toNumber(yuan[1]), signed: /^[+-]/.test(yuan[1]), anchor: 'yuan' };

  // 裸金额兜底:必须先剔除余额段(招商/工行等句式无「人民币」前缀)
  const plain = stripBalance(text).text.match(AMOUNT_PLAIN_RE);
  if (plain) return { amount: toNumber(plain[1]), signed: /^[+-]/.test(plain[1]), anchor: 'plain' };

  return null;
}

/** 解析时间;文本里没有日期时返回 null(由调用方用到达时刻兜底) */
function extractDate(text: string, ref: Date): string | null {
  const full = DATETIME_FULL_RE.exec(text);
  if (full) {
    return buildIso(
      Number(full[1]), Number(full[2]), Number(full[3]),
      Number(full[4]), minuteOf(full[5], full[7]),
    );
  }

  const refParts = beijingParts(ref);
  const md = DATETIME_MD_RE.exec(text);
  if (md) {
    return buildIso(
      inferYear(refParts, Number(md[1]), Number(md[2])), Number(md[1]), Number(md[2]),
      Number(md[3]), minuteOf(md[4], md[6]),
    );
  }

  const fullDay = DATE_FULL_RE.exec(text);
  if (fullDay) {
    // 无时分:取正午,避免 ±时区把日期推前/后一天
    return buildIso(Number(fullDay[1]), Number(fullDay[2]), Number(fullDay[3]), 12, 0);
  }

  const mdDay = DATE_MD_RE.exec(text);
  if (mdDay) {
    return buildIso(inferYear(refParts, Number(mdDay[1]), Number(mdDay[2])), Number(mdDay[1]), Number(mdDay[2]), 12, 0);
  }

  return null;
}

/** 短信只有「x月x日」没有年份:落在未来(超过 1 天)视为去年,覆盖跨年场景 */
function inferYear(ref: { year: number; month: number; day: number }, month: number, day: number): number {
  const candidate = Date.UTC(ref.year, month - 1, day);
  const refDay = Date.UTC(ref.year, ref.month - 1, ref.day);
  return candidate > refDay + 86_400_000 ? ref.year - 1 : ref.year;
}

/**
 * 时间戳单位归一化:小于 1e11 的值按「秒」处理(部分 ROM / 短信备份恢复会把 `date` 写成秒),
 * 统一成毫秒后再比较。放在 JS 侧而不是 SQL:实测部分 ROM 的 provider 对 selection / sortOrder 里的
 * SQL 表达式(如 CASE WHEN …)会**静默返回 0 行**,不报错也不抛异常,排查代价极高。
 */
export function normalizeEpochMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  return value < 100_000_000_000 ? Math.round(value * 1000) : value;
}

/**
 * 账户标识(账户名猜测)的**唯一来源**:本地解析与 AI 兜底结果都走这里,避免两条路径拼法漂移。
 * 已知尾号但不知道机构时仍保留「尾号xxxx」:至少让用户看得出是哪张卡,而不是一片空白。
 */
export function buildAccountLabel(bankName: string | null, cardTail: string | null): string | null {
  const bank = bankName?.trim() || null;
  const tail = cardTail?.trim() || null;
  if (bank && tail) return `${bank}(${tail})`;
  return bank ?? (tail ? `尾号${tail}` : null);
}

/** 银行/机构服务号(仅作置信度加分,不参与预筛:106 号段同样被营销短信使用) */
function looksLikeBankSender(sender: string | null): boolean {
  if (!sender) return false;
  const s = sender.trim();
  return /^(?:95\d{3}|1[0-9]{10}|106\d{6,})$/.test(s) || /银行|银联/.test(s);
}

/**
 * 解析交易短信 → 结构化候选。非交易短信(预筛未通过)或无可用金额时返回 null。
 * 时间优先取正文里的时间(账单时区 +08:00);正文只有日期没有时分取正午;完全无日期才用到达时刻。
 */
export function parseTransactionSms(input: ParseSmsInput): SmsTransactionCandidate | null {
  const raw = (input.text || '').trim();
  const screen = screenSms(raw);
  if (!screen.isTransaction) return null;

  const money = extractAmount(raw);
  if (!money) return null;

  const sender = input.sender?.trim() || null;
  const now = input.now ?? new Date();
  const receivedAt = input.receivedAt != null ? new Date(input.receivedAt) : now;
  const ref = isNaN(receivedAt.getTime()) ? now : receivedAt;

  // 方向:符号优先(最可靠),其次关键词;两者都没有时按支出兜底并扣置信度
  let type: RecordType;
  let directionFromSign = false;
  if (money.signed) {
    type = money.amount < 0 ? 'EXPENSE' : 'INCOME';
    directionFromSign = true;
  } else if (INCOME_WORDS.test(raw) && !EXPENSE_WORDS.test(raw)) {
    type = 'INCOME';
  } else {
    type = 'EXPENSE';
  }
  const hasDirectionWord = INCOME_WORDS.test(raw) || EXPENSE_WORDS.test(raw);

  const bracket = BANK_BRACKET_RE.exec(raw);
  const bracketBank = bracket && BANK_NAME_RE.test(bracket[1]) ? bracket[1] : null;
  // 机构名优先级:方括号 → 发件服务号 → 调用方给的来源名(通知渠道)
  // (没有它账户名会退化成空或「尾号xxxx」,账户匹配必然失败)
  const bankName = bracketBank ?? bankNameFromSender(sender) ?? (input.bankNameFallback?.trim() || null);
  const cardTail = CARD_TAIL_RES.map((re) => re.exec(raw)?.[1]).find((v) => !!v) ?? null;
  const tradeKind = TRADE_KIND_RE.exec(raw)?.[1] ?? null;
  const payer = COUNTERPARTY_RES.map((re) => re.exec(raw)?.[1]?.trim()).find((v) => !!v) ?? null;
  const detail = DETAIL_BRACE_RE.exec(raw)?.[1]?.trim() || null;

  const textDate = extractDate(raw, ref);
  const date = textDate ?? ref.toISOString();

  const accountLabel = buildAccountLabel(bankName, cardTail);
  const remark = [
    input.channel === 'notification' ? '通知' : '短信',
    accountLabel, tradeKind, payer, detail,
  ].filter(Boolean).join(' ');

  // 置信度:文本质量信号累加,上限 0.95(账户唯一匹配由服务端决定)
  let confidence = 0.5;
  if (bankName) confidence += 0.15;
  if (money.anchor !== 'plain') confidence += 0.15;
  if (textDate) confidence += 0.1;
  if (directionFromSign) confidence += 0.1;
  else if (hasDirectionWord) confidence += 0.05;
  if (payer) confidence += 0.05;
  if (cardTail) confidence += 0.05;
  if (looksLikeBankSender(sender)) confidence += 0.05;
  if (money.anchor === 'plain') confidence -= 0.1;
  if (!directionFromSign && !hasDirectionWord) confidence -= 0.15;
  confidence = Math.min(0.95, Math.max(0.2, Math.round(confidence * 100) / 100));

  return {
    sourceId: input.sourceId ?? `${date}|${Math.abs(money.amount).toFixed(2)}|${cardTail ?? ''}`,
    raw,
    sender,
    bankName,
    cardTail,
    date,
    amount: Math.abs(money.amount),
    type,
    tradeKind,
    payer,
    accountName: accountLabel,
    remark,
    balance: stripBalance(raw).balance,
    confidence,
  };
}

/**
 * 跨渠道折叠同一笔的语义键(短信与银行通知上报同一笔时用):分钟粒度 + 金额 + 方向 + 卡尾号。
 * 与 dedup.ts 的 buildDuplicateKey 分工不同:那个用于「账户内已有流水」的查重分组,字段与日期精度可配置;
 * 本函数只解决「同一笔的两个来源」这条确定性折叠,不做时可配置。
 */
export function buildSmsDedupeKey(
  c: Pick<SmsTransactionCandidate, 'date' | 'amount' | 'type' | 'cardTail' | 'bankName'>,
  accountBookId?: string | null,
): string {
  return [accountBookId ?? '', c.date.slice(0, 16), c.type, c.amount.toFixed(2), c.cardTail ?? '', c.bankName ?? ''].join('|');
}
