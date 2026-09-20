import { describe, expect, it } from 'vitest';
import {
  bankNameFromSender,
  buildSmsDedupeKey,
  normalizeEpochMs,
  parseTransactionSms,
  screenSms,
} from '../src/sms-parse.js';

// 样本来源标注:
// - 「真实样本」为用户提供的脱敏短信,字段期望值按实际银行格式锁定;
// - 「占位样本」是按常见句式构造的,接入更多真实短信后需重新校准正则与期望值。

/** 中国农业银行 · 转账支出(真实样本) */
const ABC_TRANSFER_OUT =
  '【中国农业银行】您尾号5172账户09月17日12:58向xx完成转支交易人民币-100.00，余额611.92，详见掌银。';
/** 到达时刻:北京时间 2026-09-17 13:10 */
const ABC_RECEIVED_AT = '2026-09-17T05:10:00.000Z';
const ABC_NOW = new Date('2026-09-17T05:10:00.000Z');

describe('screenSms', () => {
  it('交易短信:命中「交易字眼 + 金额」', () => {
    expect(screenSms(ABC_TRANSFER_OUT)).toEqual({ isTransaction: true, reason: 'keyword+amount' });
  });

  it('验证码类先排除(同样含数字与「交易」邻域词)', () => {
    expect(screenSms('【中国农业银行】验证码123456，请勿泄露。')).toEqual({
      isTransaction: false,
      reason: 'exclude:验证码',
    });
  });

  it('账单/还款提醒排除(不是流水)', () => {
    expect(screenSms('【招商银行】您本期账单已生成，应还金额1,234.56元，请及时还款。')).toEqual({
      isTransaction: false,
      reason: 'exclude:账单提醒',
    });
  });

  it('营销短信排除', () => {
    expect(screenSms('【招商银行】尊享优惠券，详情点击链接领取，退订回T')).toMatchObject({
      isTransaction: false,
      reason: 'exclude:营销推广',
    });
  });

  it('有交易字眼但取不到金额 → 不通过', () => {
    expect(screenSms('【中国农业银行】您尾号5172账户完成转支交易。')).toEqual({
      isTransaction: false,
      reason: 'no-amount',
    });
  });

  it('空文本', () => {
    expect(screenSms('   ')).toEqual({ isTransaction: false, reason: 'empty' });
  });
});

describe('parseTransactionSms · 农业银行转账支出(真实样本)', () => {
  const c = parseTransactionSms({ text: ABC_TRANSFER_OUT, receivedAt: ABC_RECEIVED_AT, now: ABC_NOW });

  it('解析出全部关键字段', () => {
    expect(c).not.toBeNull();
    expect(c).toMatchObject({
      bankName: '中国农业银行',
      cardTail: '5172',
      // 09月17日12:58 → +08:00 → UTC(与导入管线 parseDateStr 一致)
      date: '2026-09-17T04:58:00.000Z',
      amount: 100,
      type: 'EXPENSE',
      tradeKind: '转支',
      payer: 'xx',
      accountName: '中国农业银行(5172)',
      remark: '短信 中国农业银行(5172) 转支 xx',
      // 余额段不得被当成交易金额
      balance: 611.92,
      confidence: 0.95,
    });
    expect(c?.raw).toBe(ABC_TRANSFER_OUT);
    expect(c?.sender).toBeNull();
  });

  it('sourceId 缺省时用 时间|金额|尾号 指纹兜底(保证可做「已处理」标记)', () => {
    expect(c?.sourceId).toBe('2026-09-17T04:58:00.000Z|100.00|5172');
  });

  it('显式 sourceId 优先', () => {
    expect(parseTransactionSms({ text: ABC_TRANSFER_OUT, sourceId: 'sms:42' })?.sourceId).toBe('sms:42');
  });

  it('非交易短信返回 null', () => {
    expect(parseTransactionSms({ text: '【中国农业银行】验证码123456，请勿泄露。' })).toBeNull();
  });
});

describe('运营商账单 / 服务提醒(真实样本,必须排除)', () => {
  // 两段都含「消费/代扣 + 数字元」,不排除就会被当成流水:
  // 前者是月度账单汇总(8.10 元),后者的「可透支100元」是额度不是交易
  const CMCC_BILL =
    '【话费账单】尊敬的134****9491客户，您07月27日-08月26日共消费8.10元。 主要消费项目包括：\n-套餐及固定费8.00元；\n-套餐外短彩信费0.10元。\n账单详情，请点击 https://dx.10086.cn/lRUBDw 前往中国移动APP查询。可编辑短信CXYHZD发送到10086查询优惠账单。更多信息可详询10086，心级服务，10分满意！【中国移动】';
  const CMCC_OVERDRAFT =
    '【话费透支服务】尊敬的客户，您的135****9671话费余额已不足。因您为银卡客户，可透支100元，透支额度内可正常通信，超出透支额度将停机。为了避免您号码停机导致无法正常使用，建议您及时充值（若您已充值，请忽略本提醒）。如您不需要话费透支服务，可回复QXED取消。查余额、充话费、查账单、办理话费代扣（原话费自动充值），点击 http://dx.10086.cn/TRvqEbu 直达。【中国移动】';

  it('话费账单汇总:以「账单汇总」排除', () => {
    expect(screenSms(CMCC_BILL)).toEqual({ isTransaction: false, reason: 'exclude:账单汇总' });
    expect(parseTransactionSms({ text: CMCC_BILL })).toBeNull();
  });

  it('话费透支/余额提醒:以「余额额度提醒」排除(否则「可透支100元」会变成一笔 100 元支出)', () => {
    expect(screenSms(CMCC_OVERDRAFT)).toEqual({ isTransaction: false, reason: 'exclude:余额额度提醒' });
    expect(parseTransactionSms({ text: CMCC_OVERDRAFT })).toBeNull();
  });

  it('真实流水里的「余额」「账单详情」字样不会被误排除', () => {
    expect(
      screenSms('【招商银行】您账户****5678于09月17日14:30消费88.00，可用余额2000.00，账单详情见掌上生活。'),
    ).toEqual({ isTransaction: true, reason: 'keyword+amount' });
  });
});

describe('服务 / 权益类通知(真实样本,必须排除)', () => {
  // 这批的共同点:含「到账 / 消费 / 充值」等交易字眼与金额,但都不是资金收支本身
  const CASES: { name: string; reason: string; text: string }[] = [
    { name: '电信充值到账', reason: 'exclude:充值提醒', text: '尊敬的客户，您充值100元，已到账。[中国电信]' },
    {
      name: '华为云自动续费(0 元)',
      reason: 'exclude:金额为零',
      text: '【华为云】尊敬的hw_008613522939671_02：您有1个包年/包月资源于2023/05/14 04:10:51自动续费成功，消费金额为0.00元，详情请查看邮件。感谢您对华为云的支持！',
    },
    {
      name: '移动月度用量播报',
      reason: 'exclude:账单汇总',
      text: '【5G视频客服提示您】尊敬的客户，截止到7月7日，您当月消费合计为90.00元，话费余额18.13元。国内语音共200分钟，已用1分钟，剩余199分钟；国内通用流量共75G，已用8.21G，剩余66.79G；其中国内通用流量结转共30G，已用8.21G，剩余21.79G。更多信息请点击:https://dx.10086.cn/v2d0EQ?sid=TR-8sXnP7NU。【中国移动】',
    },
    {
      name: '腾讯云代金券到账',
      reason: 'exclude:优惠权益',
      text: '【腾讯云】尊敬的用户，您的账号下（账号ID：100009507850，昵称：你午睡了嘛）,有1张面值为5.00元的2024新春采购节的代金券/现金券已到账，详细信息请前往微信小程序-腾讯云助手查看：https://mc.tencent.com/19BgmIQC 。',
    },
    {
      name: '神州租车押金解冻',
      reason: 'exclude:资金冻结解冻',
      text: '【神州租车】您的订单17070189675732已还车，取车时的订单押金5000.00元，已解冻3000.00元，已解冻押金需要您登录神州租车APP自行操作退还，操作成功后3-5个工作日到账，剩余2000.00元违章押金，如无违章及其他欠款，将在还车30天后解冻，届时请及时登录神州租车APP操作退还。',
    },
    {
      name: '移动权益到账(京东秒送券)',
      reason: 'exclude:优惠权益',
      text: '【权益到账提醒】尊敬的全球通客户，您好！您已获得京东秒送7元外卖优惠餐券权益，将于24小时内到达相应APP账户。【中国移动】',
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → ${c.reason}`, () => {
      expect(screenSms(c.text)).toEqual({ isTransaction: false, reason: c.reason });
      expect(parseTransactionSms({ text: c.text })).toBeNull();
    });
  }
});

describe('农行「尾号为5172」句式(真实样本)', () => {
  // 实测问题:短信与 App 通知都写「尾号为5172」,而尾号正则原本只认「尾号5172 / 尾数为5172」——
  // 尾号整条丢失 → 账户名退化成「中国农业银行」(无尾号)→ 账户匹配失败,落进「未识别账户」
  const ABC_INCOME = '您尾号为5172的农行借记卡于09月21日09:34发生一笔收入1.00元，详情请点击';

  it('预筛通过(「详情请点击」不属营销排除词)', () => {
    expect(screenSms(ABC_INCOME)).toEqual({ isTransaction: true, reason: 'keyword+amount' });
  });

  it('解析出卡尾号与带尾号的账户名,方向为收入', () => {
    const c = parseTransactionSms({
      text: ABC_INCOME,
      sender: '95599',
      receivedAt: '2026-09-21T01:34:30.000Z', // 北京时间 09:34 到达
      now: new Date('2026-09-21T01:34:30.000Z'),
    });
    expect(c).toMatchObject({
      bankName: '中国农业银行',
      cardTail: '5172',
      accountName: '中国农业银行(5172)',
      amount: 1,
      type: 'INCOME',
      date: '2026-09-21T01:34:00.000Z',
    });
  });

  it('「尾数是 / 尾数」等写法同样取到尾号(机构名缺失时仍保留「尾号xxxx」)', () => {
    expect(parseTransactionSms({ text: '您尾数是5172的账户消费10.00元。' })?.cardTail).toBe('5172');
    expect(parseTransactionSms({ text: '您尾数5172账户消费10.00元。' })?.accountName).toBe('尾号5172');
  });
});

describe('神州租车(真实样本):实付保留、解冻排除', () => {
  // 这类短信两头都沾:「支付租车费用4004.00元」是真实资金流出(要记支出),
  // 但「应退23.67元…3-5个工作日到账」会让方向判定偏成收入 —— 所以 EXPENSE_WORDS 必须认「支付」
  const RENT_PAY =
    '【神州租车】客户您好，您于2024-02-04 11:56:14在上海周浦地铁站服务点支付租车费用4004.00元，应退23.67元至原账户，3-5个工作日到账，请注意查收。';
  const DEPOSIT_PAY =
    '【神州租车】客户您好，您于2024-02-04 13:29:09在上海周浦地铁站服务点支付订单押金5000.00元，应退2000.00元至原账户，3-5个工作日到账，请注意查收。';

  it('租车费:记为支出 4004(不被「到账」带偏成收入)', () => {
    expect(parseTransactionSms({ text: RENT_PAY })).toMatchObject({ amount: 4004, type: 'EXPENSE' });
  });

  it('押金实付:记为支出 5000(退还时会另有收入流水)', () => {
    expect(parseTransactionSms({ text: DEPOSIT_PAY })).toMatchObject({ amount: 5000, type: 'EXPENSE' });
  });
});

describe('消费信贷账单提醒(真实样本,必须排除)', () => {
  // 实测问题:「还款」命中交易字眼 + 「27.56元」命中金额 → 被判成一笔 27.56 元支出。
  // 但这是「待还」提醒:钱还没动,真正的还款会另有流水,收进去就是提前记 + 重复记。
  const MEITUAN_PAY_LATER =
    '【美团月付】您8月账单27.56元待还，最后还款日为8月22号，查账或立即还款点击 mt.cn/S8EsAe2a';

  it('以「账单提醒」排除', () => {
    expect(screenSms(MEITUAN_PAY_LATER)).toEqual({ isTransaction: false, reason: 'exclude:账单提醒' });
    expect(parseTransactionSms({ text: MEITUAN_PAY_LATER })).toBeNull();
  });

  it('已发生的还款流水不受影响(没有「待还 / 最后还款日」这类提醒措辞)', () => {
    expect(screenSms('【招商银行】您尾号1234信用卡还款人民币1,000.00元已入账。')).toEqual({
      isTransaction: true,
      reason: 'keyword+amount',
    });
  });
});

describe('支付宝花呗支出(真实样本,不能被「请及时还款」误杀)', () => {
  // 实测问题:花呗支付成功通知末尾带「请及时还款」,原来整条被判成账单提醒排除 → 真实支出丢失
  const ALIPAY_HUABEI = '你有一笔179.51元的支出，点击查看详情。使用花呗支付。请及时还款。';

  it('预筛通过:没有账单 / 应还语境时不算提醒', () => {
    expect(screenSms(ALIPAY_HUABEI)).toEqual({ isTransaction: true, reason: 'keyword+amount' });
    expect(parseTransactionSms({ text: ALIPAY_HUABEI })).toMatchObject({ amount: 179.51, type: 'EXPENSE' });
  });

  it('真正的账单提醒不受影响(「应还」+「请及时还款」)', () => {
    // 这条没有任何「账单提醒」主关键词,只靠「应还 … 请及时还款」的组合命中
    expect(screenSms('【某银行】您应还金额1,234.56元，请及时还款。')).toEqual({
      isTransaction: false,
      reason: 'exclude:账单提醒',
    });
  });
});

describe('运营商充值提醒(真实样本,必须排除)', () => {
  // 实测问题:「到账」命中交易字眼 + 「100.00元」命中金额 → 被判成一笔 100 元收入。
  // 这是「充值成功」的服务通知,不是银行动账;同一笔话费在支付渠道通常还有一条流水。
  const CMCC_RECHARGE =
    '【充值到账提醒】尊敬的客户，您于2026年09月03日08时45分40秒通过中国移动APP充值服务为您成功充值100.00元。查余额请点击 https://dx.10086.cn/A/0Fi2uEfm 直达中国移动APP，畅享线上便捷服务。【中国移动】';

  it('以「充值提醒」排除', () => {
    expect(screenSms(CMCC_RECHARGE)).toEqual({ isTransaction: false, reason: 'exclude:充值提醒' });
    expect(parseTransactionSms({ text: CMCC_RECHARGE })).toBeNull();
  });

  it('真实动账短信里的「充值」字样不受影响(银行流水不写「成功充值」这类服务话术)', () => {
    expect(screenSms('【中国农业银行】您尾号5172账户09月17日12:58完成转支交易人民币-100.00，余额611.92。')).toEqual({
      isTransaction: true,
      reason: 'keyword+amount',
    });
  });
});

describe('建设银行 · 营销短信(真实样本,必须排除)', () => {
  // 实测问题:这条同时含「消费直抵」与「最高8.88元立减金」,被当成一笔 8.88 元支出。
  // 它的营销特征在两处:① 页脚是「拒收请回复R」而非「退订回T」;② 促销话术(限时优惠/立减金/先到先得)
  const CCB_PROMO =
    '【建设银行】限时优惠！月月领红包，最高8.88元立减金，消费直抵！每月限1次，共计3万份，数量有限，先到先得，抢完即止，如已参与请忽，点击s.ccb.cn/s/a/Zmq。拒收请回复R';

  it('以「营销推广」排除(页脚「拒收请回复R」)', () => {
    expect(screenSms(CCB_PROMO)).toEqual({ isTransaction: false, reason: 'exclude:营销推广' });
    expect(parseTransactionSms({ text: CCB_PROMO })).toBeNull();
  });

  it('即使没有页脚,促销话术同样能排除(不依赖单家银行的固定页脚)', () => {
    expect(screenSms(CCB_PROMO.replace('拒收请回复R', ''))).toEqual({
      isTransaction: false,
      reason: 'exclude:促销话术',
    });
  });
});

describe('建设银行 · 动账提醒(真实样本)', () => {
  const CCB_ALERT = '您尾号4640的储蓄账户6月14日15时32分收入人民币1.00元。点击查看>>';
  const RECEIVED_AT = '2026-06-14T07:32:00.000Z'; // 北京时间 15:32 到达
  const NOW = new Date(RECEIVED_AT);

  it('预筛通过:命中交易字眼 + 金额(「点击查看」不在营销排除词里)', () => {
    expect(screenSms(CCB_ALERT)).toEqual({ isTransaction: true, reason: 'keyword+amount' });
  });

  it('通知渠道:中文「15时32分」可解析(不再退化成当天正午);机构名由来源名兜底;备注前缀为通知', () => {
    const c = parseTransactionSms({
      text: CCB_ALERT,
      sender: '中国建设银行',
      channel: 'notification',
      bankNameFallback: '中国建设银行',
      receivedAt: RECEIVED_AT,
      now: NOW,
    });
    expect(c).toMatchObject({
      type: 'INCOME',
      amount: 1,
      // 15时32分 → +08:00 → UTC
      date: '2026-06-14T07:32:00.000Z',
      bankName: '中国建设银行',
      cardTail: '4640',
      // 只写方向不写业务类型:方向词本身作为源分类,分类映射才有可命中的键
      tradeKind: '收入',
      accountName: '中国建设银行(4640)',
      remark: '通知 中国建设银行(4640) 收入',
      confidence: 0.95,
    });
  });

  it('短信渠道:服务号 95533 直接推出机构名,备注前缀为短信', () => {
    const c = parseTransactionSms({ text: CCB_ALERT, sender: '95533', receivedAt: RECEIVED_AT, now: NOW });
    expect(c).toMatchObject({
      bankName: '中国建设银行',
      cardTail: '4640',
      accountName: '中国建设银行(4640)',
      date: '2026-06-14T07:32:00.000Z',
      tradeKind: '收入',
      remark: '短信 中国建设银行(4640) 收入',
      confidence: 0.95,
    });
  });

  it('「HH点MM分」写法同样可解析', () => {
    const c = parseTransactionSms({
      text: '您尾号4640的储蓄账户6月14日15点32分收入人民币1.00元。',
      sender: '95533',
      receivedAt: RECEIVED_AT,
      now: NOW,
    });
    expect(c?.date).toBe('2026-06-14T07:32:00.000Z');
  });
});

describe('工商银行 · 动账通知(真实样本)', () => {
  // 采集层把通知的「标题 + 正文」用空格拼接后再解析
  const ICBC_ALERT =
    '中国工商银行 动账通知 尾号9287卡8月27日16:28工商银行收入{他行汇入}0.01元。请点击查看详情。';
  const RECEIVED_AT = '2026-08-27T08:30:00.000Z'; // 北京时间 16:30 到达
  const NOW = new Date(RECEIVED_AT);

  it('预筛通过:命中「收入」+「0.01元」(「请点击查看详情」不属营销排除词)', () => {
    expect(screenSms(ICBC_ALERT)).toEqual({ isTransaction: true, reason: 'keyword+amount' });
  });

  it('通知渠道:冒号时分 + 卡尾号 + 机构名兜底 + 花括号说明进备注', () => {
    const c = parseTransactionSms({
      text: ICBC_ALERT,
      sender: '中国工商银行',
      channel: 'notification',
      bankNameFallback: '中国工商银行',
      receivedAt: RECEIVED_AT,
      now: NOW,
    });
    expect(c).toMatchObject({
      type: 'INCOME',
      amount: 0.01,
      // 8月27日16:28 → +08:00 → UTC
      date: '2026-08-27T08:28:00.000Z',
      bankName: '中国工商银行',
      cardTail: '9287',
      tradeKind: '收入',
      // {他行汇入} 不是交易对手,单独保留进备注,不在入库时丢掉
      payer: null,
      accountName: '中国工商银行(9287)',
      remark: '通知 中国工商银行(9287) 收入 他行汇入',
      confidence: 0.95,
    });
  });

  it('短信渠道(95588):机构名取自服务号表,备注前缀为短信', () => {
    const c = parseTransactionSms({ text: ICBC_ALERT, sender: '95588', receivedAt: RECEIVED_AT, now: NOW });
    expect(c).toMatchObject({
      bankName: '中国工商银行',
      accountName: '中国工商银行(9287)',
      remark: '短信 中国工商银行(9287) 收入 他行汇入',
      confidence: 0.95,
    });
  });

  it('小额(0.01)不影响解析,是否入账由「金额下限」规则决定', () => {
    const c = parseTransactionSms({ text: ICBC_ALERT, sender: '95588', receivedAt: RECEIVED_AT, now: NOW });
    expect(c?.amount).toBe(0.01);
  });
});

describe('parseTransactionSms · 通用句式(占位样本)', () => {
  it('带 + 符号 → 收入', () => {
    const c = parseTransactionSms({
      text: '【中国工商银行】您尾号1234账户09月17日10:00收入人民币+200.00元，余额1000.00。',
      receivedAt: '2026-09-17T02:10:00.000Z',
      now: new Date('2026-09-17T02:10:00.000Z'),
    });
    expect(c).toMatchObject({
      type: 'INCOME',
      amount: 200,
      cardTail: '1234',
      date: '2026-09-17T02:00:00.000Z',
      balance: 1000,
      // 句式里只写了方向(收入),方向词即源分类
      tradeKind: '收入',
    });
  });

  it('无符号 + 支出关键词 → 支出;掩码卡号可识别;裸金额兜底不进余额', () => {
    const c = parseTransactionSms({
      text: '【招商银行】您账户****5678于09月17日14:30消费88.00，余额2000.00。',
      receivedAt: '2026-09-17T06:10:00.000Z',
      now: new Date('2026-09-17T06:10:00.000Z'),
    });
    expect(c).toMatchObject({
      type: 'EXPENSE',
      amount: 88,
      cardTail: '5678',
      date: '2026-09-17T06:30:00.000Z',
      balance: 2000,
      payer: null,
      // 裸金额锚点 + 无符号方向:「金额可信、方向靠关键词」的中间档
      confidence: 0.75,
    });
  });

  it('短信只有月日 → 落在未来时推断为去年(跨年)', () => {
    const c = parseTransactionSms({
      text: '【中国农业银行】您尾号5172账户12月31日23:30向xx完成转支交易人民币-50.00，余额100.00。',
      receivedAt: '2026-01-01T01:00:00.000Z',
      now: new Date('2026-01-01T01:00:00.000Z'),
    });
    expect(c?.date).toBe('2025-12-31T15:30:00.000Z');
  });

  it('正文无日期 → 用短信到达时刻', () => {
    const c = parseTransactionSms({
      text: '【中国农业银行】您尾号5172账户向xx完成转支交易人民币-30.00。',
      receivedAt: '2026-09-17T05:00:00.000Z',
    });
    expect(c?.date).toBe('2026-09-17T05:00:00.000Z');
  });

  it('只有日期没有时分 → 取正午(避免时区把日期推前/后一天)', () => {
    const c = parseTransactionSms({
      text: '【中国农业银行】您尾号5172账户09月17日向xx完成转支交易人民币-30.00。',
      receivedAt: '2026-09-17T05:00:00.000Z',
      now: new Date('2026-09-17T05:00:00.000Z'),
    });
    expect(c?.date).toBe('2026-09-17T04:00:00.000Z');
  });

  it('无银行前缀、无方向依据 → 方向按支出兜底但置信度明显偏低(交人工确认)', () => {
    const c = parseTransactionSms({
      text: '您账户交易人民币100.00',
      receivedAt: '2026-09-17T05:00:00.000Z',
      now: new Date('2026-09-17T05:00:00.000Z'),
    });
    expect(c).toMatchObject({ type: 'EXPENSE', confidence: 0.5, bankName: null, cardTail: null });
  });
});

describe('机构名推断(方括号缺失时用发件服务号兜底)', () => {
  // 实测问题:代扣/动账类短信常没有【银行】前缀,只有卡尾号 →
  // 账户名退化成空,列表里一片「未识别账户」,账户匹配必然失败
  const NO_BRACKET =
    '您尾号9671账户09月05日18:54代扣人民币10.00，余额100.00，请知悉。';

  it('发件号 95599 → 补出银行名,账户名可参与匹配', () => {
    const c = parseTransactionSms({
      text: NO_BRACKET,
      sender: '95599',
      receivedAt: '2026-09-05T10:54:00.000Z',
      now: new Date('2026-09-05T10:54:00.000Z'),
    });
    expect(c).toMatchObject({
      bankName: '中国农业银行',
      cardTail: '9671',
      accountName: '中国农业银行(9671)',
      remark: '短信 中国农业银行(9671) 代扣',
      type: 'EXPENSE',
      amount: 10,
    });
  });

  it('106 聚合号段里包含服务号同样可识别(106980095599 → 95599)', () => {
    const c = parseTransactionSms({ text: NO_BRACKET, sender: '106980095599' });
    expect(c?.bankName).toBe('中国农业银行');
    expect(c?.accountName).toBe('中国农业银行(9671)');
  });

  it('方括号机构名优先于发件号(支付宝短信用 95599 号段时不被改写成银行)', () => {
    const c = parseTransactionSms({
      text: '【支付宝】您尾号9671账户09月05日18:54消费人民币10.00。',
      sender: '95599',
    });
    expect(c?.bankName).toBe('支付宝');
    expect(c?.accountName).toBe('支付宝(9671)');
  });

  it('既无方括号也无发件号:保留「尾号9671」而不是空账户名(人工指定账户时看得清是哪张卡)', () => {
    const c = parseTransactionSms({ text: NO_BRACKET });
    expect(c).toMatchObject({ bankName: null, cardTail: '9671', accountName: '尾号9671' });
  });
});

describe('normalizeEpochMs(时间戳单位容错)', () => {
  it('「秒」级时间戳 ×1000;毫秒原样;非法值原样返回', () => {
    expect(normalizeEpochMs(1785816290)).toBe(1785816290000);
    expect(normalizeEpochMs(1785816290938)).toBe(1785816290938);
    expect(normalizeEpochMs(0)).toBe(0);
    expect(normalizeEpochMs(-1)).toBe(-1);
    expect(Number.isNaN(normalizeEpochMs(NaN))).toBe(true);
  });
});

describe('bankNameFromSender(筛选规则的发件人下拉用它显示友好标签)', () => {
  it('精确服务号 / 106 聚合号段 / 未知号段', () => {
    expect(bankNameFromSender('95599')).toBe('中国农业银行');
    expect(bankNameFromSender('106980095599')).toBe('中国农业银行');
    expect(bankNameFromSender('10086')).toBeNull();
    expect(bankNameFromSender('')).toBeNull();
    expect(bankNameFromSender(null)).toBeNull();
  });
});

describe('buildSmsDedupeKey', () => {
  const base = {
    date: '2026-09-17T04:58:00.000Z',
    amount: 100,
    type: 'EXPENSE' as const,
    cardTail: '5172',
    bankName: '中国农业银行',
  };

  it('分钟粒度 + 金额 + 方向 + 卡尾号', () => {
    expect(buildSmsDedupeKey(base, 'book1')).toBe(
      'book1|2026-09-17T04:58|EXPENSE|100.00|5172|中国农业银行',
    );
  });

  it('同分钟同笔(短信 / 通知双渠道)折叠为同一键', () => {
    const fromNotification = { ...base, date: '2026-09-17T04:58:47.000Z' };
    expect(buildSmsDedupeKey(fromNotification, 'book1')).toBe(buildSmsDedupeKey(base, 'book1'));
  });

  it('金额不同则不折叠', () => {
    expect(buildSmsDedupeKey({ ...base, amount: 101 }, 'book1')).not.toBe(buildSmsDedupeKey(base, 'book1'));
  });
});
