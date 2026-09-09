import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import {
  detectEncoding,
  parseDateStr,
  parseAlipayCSV,
  resolveAlipayAccountName,
  parseWechatXlsx,
  resolveWechatAccountName,
  parseJdCSV,
  detectHeaderIndex,
  parseCsvWithMapping,
} from '../src/services/import/parsers.js';

// ============ 通用工具 ============

describe('detectEncoding', () => {
  it('UTF-8 BOM 识别为 utf8', () => {
    const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('任意内容', 'utf8')]);
    expect(detectEncoding(buf)).toBe('utf8');
  });

  it('UTF-8 无 BOM 中文内容 → utf8(严格解码,含通用 CSV)', () => {
    const buf = Buffer.from('日期,金额,类型\n2024-01-15,25,支出', 'utf8');
    expect(detectEncoding(buf)).toBe('utf8');
  });

  it('UTF-8 无 BOM 且含支付宝表头关键词 → utf8', () => {
    const buf = Buffer.from('交易时间,收/支\n', 'utf8');
    expect(detectEncoding(buf)).toBe('utf8');
  });

  it('GBK 编码内容回退 gbk', () => {
    const buf = iconv.encode('交易时间,金额\n', 'gbk');
    expect(detectEncoding(buf)).toBe('gbk');
  });

  it('空 buffer 按合法 UTF-8 处理;截断序列回退 gbk', () => {
    expect(detectEncoding(Buffer.alloc(0))).toBe('utf8');
    // 单 0xEF 是不完整的三字节序列,严格解码失败 → gbk
    expect(detectEncoding(Buffer.from([0xEF]))).toBe('gbk');
  });
});

describe('parseDateStr', () => {
  it('标准日期时间 → UTC ISO(+08:00 偏移)', () => {
    expect(parseDateStr('2024-01-15 10:30:00')).toBe('2024-01-15T02:30:00.000Z');
  });

  it('斜杠与单位数月日', () => {
    expect(parseDateStr('2024/1/5')).toBe('2024-01-04T16:00:00.000Z');
  });

  it('中文日期格式', () => {
    expect(parseDateStr('2024年1月15日 10时30分')).toBe('2024-01-15T02:30:00.000Z');
  });

  it('空串返回 null', () => {
    expect(parseDateStr('')).toBeNull();
  });

  it('数字不足 3 段返回 null', () => {
    expect(parseDateStr('2024-01')).toBeNull();
    expect(parseDateStr('abc')).toBeNull();
  });

  it('非法日期(13月)返回 null', () => {
    expect(parseDateStr('2024-13-01')).toBeNull();
  });
});

// ============ 支付宝 ============

describe('resolveAlipayAccountName', () => {
  it('空名回退 支付宝', () => {
    expect(resolveAlipayAccountName('')).toBe('支付宝');
  });

  it('内部账户名归一为 支付宝', () => {
    for (const n of ['余额宝', '花呗', '支付宝', '账户余额', '集分宝', '红包', '淘金币', '他人代付']) {
      expect(resolveAlipayAccountName(n)).toBe('支付宝');
    }
  });

  it('外部账户名保持原样', () => {
    expect(resolveAlipayAccountName('招商银行(1234)')).toBe('招商银行(1234)');
  });
});

/** 构造支付宝 CSV 文本 */
function alipayCsv(rows: string[][], opts: { header?: string[]; preamble?: string[] } = {}): string {
  const header = opts.header ?? [
    '交易时间', '交易分类', '交易对方', '对方账号', '商品说明', '收/支', '金额', '收/付款方式', '交易状态', '交易订单号', '商家订单号', '备注',
  ];
  const lines = [...(opts.preamble ?? []), header.join(','), ...rows.map((r) => r.join(','))];
  return lines.join('\n');
}

/** 标准支出行字段(按 alipayCsv 表头顺序) */
const ALI_ROW = {
  date: '2024-01-15 10:30:00',
  category: '餐饮美食',
  counterparty: '肯德基',
  counterpartyAccount: '',
  description: '午餐',
  direction: '支出',
  amount: '35.50',
  paymentMethod: '招商银行(1111)',
  status: '交易成功',
  orderNo: '',
  merchantNo: '',
  remark: '',
};
const aliRow = (over: Partial<typeof ALI_ROW> = {}): string[] => Object.values({ ...ALI_ROW, ...over });

describe('parseAlipayCSV', () => {
  it('找不到表头行 → 报错', () => {
    const r = parseAlipayCSV(Buffer.from('不是支付宝文件\n没有表头\n', 'utf8'));
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]).toContain('无法找到CSV表头行');
  });

  it('基本支出行', () => {
    const r = parseAlipayCSV(Buffer.from(alipayCsv([aliRow()]), 'utf8'));
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.type).toBe('EXPENSE');
    expect(row.amount).toBe(35.5);
    expect(row.accountName).toBe('招商银行(1111)');
    expect(row.toAccountName).toBeNull();
    expect(row.payer).toBe('肯德基');
    expect(row.categoryCode).toBe('餐饮美食');
    expect(row.remark).toBe('午餐');
    expect(row.tags).toEqual(['导入', '支付宝']);
    expect(row.rowIndex).toBe(2);
  });

  it('收入方向 → INCOME', () => {
    const r = parseAlipayCSV(Buffer.from(alipayCsv([aliRow({ direction: '收入', amount: '100.00' })]), 'utf8'));
    expect(r.rows[0].type).toBe('INCOME');
  });

  it('交易关闭/已关闭行被跳过', () => {
    const r = parseAlipayCSV(
      Buffer.from(alipayCsv([aliRow({ status: '交易关闭' }), aliRow({ status: '已关闭' })]), 'utf8'),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('金额为 0 或非数字被跳过', () => {
    const r = parseAlipayCSV(Buffer.from(alipayCsv([aliRow({ amount: '0' }), aliRow({ amount: 'abc' })]), 'utf8'));
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });

  it('日期无法解析 → 记入 errors 且跳过该行', () => {
    const r = parseAlipayCSV(Buffer.from(alipayCsv([aliRow({ date: 'bad-date' })]), 'utf8'));
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('日期格式无法解析');
  });

  it('有前导说明行时错误行号与数据行号按原文件偏移', () => {
    // 前导 2 行 + 表头 1 行 → 首条数据在第 4 行
    const r = parseAlipayCSV(
      Buffer.from(alipayCsv([aliRow(), aliRow({ date: 'bad-date' })], { preamble: ['支付宝交易明细查询', '起始时间:2024-01-01'] }), 'utf8'),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].rowIndex).toBe(4);
    expect(r.errors[0]).toContain('第5行');
  });

  it('GBK 编码文件正常解析', () => {
    const r = parseAlipayCSV(iconv.encode(alipayCsv([aliRow()]), 'gbk'));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].payer).toBe('肯德基');
  });

  it('收/支方式 列名兼容(旧版导出)', () => {
    const header = [
      '交易时间', '交易分类', '交易对方', '对方账号', '商品说明', '收/支', '金额', '收/支方式', '交易状态', '交易订单号', '商家订单号', '备注',
    ];
    const r = parseAlipayCSV(Buffer.from(alipayCsv([aliRow()], { header }), 'utf8'));
    expect(r.rows[0].accountName).toBe('招商银行(1111)');
  });

  describe('不计收支分支推断', () => {
    const neutral = { direction: '不计收支', status: '交易成功' };

    it('花呗还款(信用借还) → TRANSFER 到 支付宝', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '信用借还', counterparty: '花呗', description: '花呗还款' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('TRANSFER');
      expect(r.rows[0].toAccountName).toBe('支付宝');
    });

    it('描述含收益 → INCOME', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '投资理财', description: '余额宝-收益发放' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('INCOME');
    });

    it('提现到银行卡 → TRANSFER 到对方账户', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, description: '提现-到银行卡', counterparty: '招商银行(2222)' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('TRANSFER');
      expect(r.rows[0].toAccountName).toBe('招商银行(2222)');
    });

    it('充值 → TRANSFER 到 支付宝', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, description: '充值-话费充值' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('TRANSFER');
      expect(r.rows[0].toAccountName).toBe('支付宝');
    });

    it('余额宝转入 → TRANSFER 到 支付宝', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '投资理财', counterparty: '余额宝', description: '转入' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('TRANSFER');
      expect(r.rows[0].toAccountName).toBe('支付宝');
    });

    it('支付宝转入到余利宝(网商银行) → 与余额宝转入同规则,内部跳过(2026-09 真实账单回归)', () => {
      // 付款方式为"账户余额" → 支付宝→支付宝,应跳过而非落 UNKNOWN 被路由分流
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '投资理财', counterparty: '网商银行', description: '支付宝转入到余利宝', paymentMethod: '账户余额' })]), 'utf8'),
      );
      expect(r.rows).toHaveLength(0);
    });

    it('银行卡转入余利宝 → TRANSFER 到 支付宝', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '投资理财', counterparty: '网商银行', description: '支付宝转入到余利宝', paymentMethod: '农业银行储蓄卡(5172)' })]), 'utf8'),
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].type).toBe('TRANSFER');
      expect(r.rows[0].toAccountName).toBe('支付宝');
    });

    it('蚂蚁财富 → TRANSFER 到 蚂蚁财富', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '投资理财', counterparty: '蚂蚁财富', description: '买入' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('TRANSFER');
      expect(r.rows[0].toAccountName).toBe('蚂蚁财富');
    });

    it('蚂蚁智还转出到银行卡 → TRANSFER 到银行卡', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '投资理财', counterparty: '招商银行(3333)', description: '蚂蚁智还-转出到银行卡' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('TRANSFER');
      expect(r.rows[0].toAccountName).toBe('招商银行(3333)');
    });

    it('退款成功状态 → INCOME', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, status: '退款成功' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('INCOME');
    });

    it('无法识别的不计收支 → UNKNOWN', () => {
      const r = parseAlipayCSV(
        Buffer.from(alipayCsv([aliRow({ ...neutral, category: '其他', description: '某操作' })]), 'utf8'),
      );
      expect(r.rows[0].type).toBe('UNKNOWN');
    });
  });

  it('账户与目标账户均为 支付宝 的内部转账被跳过', () => {
    // 花呗还款但付款方式也是内部账户(花呗) → 支付宝→支付宝
    const r = parseAlipayCSV(
      Buffer.from(alipayCsv([aliRow({ direction: '不计收支', category: '信用借还', counterparty: '花呗', description: '花呗还款', paymentMethod: '花呗' })]), 'utf8'),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('备注拼接:说明|对方|状态(非交易成功)|订单|商户单|备注', () => {
    const r = parseAlipayCSV(
      Buffer.from(alipayCsv([aliRow({
        counterpartyAccount: '2088@qq.com',
        status: '退款成功',
        orderNo: '202401150001',
        merchantNo: 'M001',
        remark: '自定义备注',
      })]), 'utf8'),
    );
    expect(r.rows[0].remark).toBe('午餐 | 对方:2088@qq.com | 状态:退款成功 | 订单:202401150001 | 商户单:M001 | 自定义备注');
  });

  it('状态为交易成功时备注不含状态段', () => {
    const r = parseAlipayCSV(Buffer.from(alipayCsv([aliRow()]), 'utf8'));
    expect(r.rows[0].remark).toBe('午餐');
  });

  it('前导说明行不影响表头定位', () => {
    const r = parseAlipayCSV(
      Buffer.from(alipayCsv([aliRow()], { preamble: ['支付宝交易明细查询', '起始时间:2024-01-01'] }), 'utf8'),
    );
    expect(r.rows).toHaveLength(1);
  });
});

// ============ 微信 ============

describe('resolveWechatAccountName', () => {
  it('空名与占位符 / 与 \\ 回退 微信', () => {
    expect(resolveWechatAccountName('')).toBe('微信');
    expect(resolveWechatAccountName('/')).toBe('微信');
    expect(resolveWechatAccountName('\\')).toBe('微信');
  });

  it('零钱/零钱通归一为 微信', () => {
    expect(resolveWechatAccountName('零钱')).toBe('微信');
    expect(resolveWechatAccountName('零钱通')).toBe('微信');
  });

  it('外部账户名保持原样', () => {
    expect(resolveWechatAccountName('招商银行')).toBe('招商银行');
  });
});

/** 构造微信 XLSX buffer(aoa: 二维数组,首行为表头前可插入 preamble) */
function wechatXlsx(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const WX_HEADER = ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'];
const wxRow = (over: Record<string, unknown> = {}): unknown[] => {
  const r = {
    time: '2024-01-15 10:30:00',
    tradeType: '商户消费',
    counterparty: '美团',
    product: '外卖订单',
    direction: '支出',
    amount: '25.00',
    paymentMethod: '零钱',
    status: '支付成功',
    orderNo: '10001',
    merchantNo: 'M01',
    remark: '/',
    ...over,
  };
  return [r.time, r.tradeType, r.counterparty, r.product, r.direction, r.amount, r.paymentMethod, r.status, r.orderNo, r.merchantNo, r.remark];
};

describe('parseWechatXlsx', () => {
  it('找不到表头 → 报错', () => {
    const r = parseWechatXlsx(wechatXlsx([['微信支付账单明细'], ['没有表头列']]));
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]).toContain('无法找到表头行');
  });

  it('基本支出行(字符串日期)', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ paymentMethod: '招商银行' })]));
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.type).toBe('EXPENSE');
    expect(row.date).toBe('2024-01-15T02:30:00.000Z');
    expect(row.amount).toBe(25);
    expect(row.accountName).toBe('招商银行');
    expect(row.payer).toBe('美团');
    expect(row.categoryCode).toBe('商户消费');
    expect(row.tags).toEqual(['导入', '微信']);
  });

  it('Excel 序列号日期(北京墙上时间语义) → UTC ISO', () => {
    // serial 45306 = 2024-01-15 00:00 北京时间 → UTC 前一日 16:00
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ time: 45306, paymentMethod: '招商银行' })]));
    expect(r.rows[0].date).toBe('2024-01-14T16:00:00.000Z');
  });

  it('含时间成分的 Excel 序列号与字符串路径一致(无 8 小时偏移)', () => {
    // serial 45306.4375 = 2024-01-15 10:30 北京时间 = 02:30 UTC
    const serial = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ time: 45306.4375, paymentMethod: '招商银行' })]));
    const str = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ time: '2024-01-15 10:30:00', paymentMethod: '招商银行' })]));
    expect(serial.rows[0].date).toBe('2024-01-15T02:30:00.000Z');
    expect(serial.rows[0].date).toBe(str.rows[0].date);
  });

  it('收入方向 → INCOME', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ direction: '收入' })]));
    expect(r.rows[0].type).toBe('INCOME');
  });

  it('退款状态 → INCOME', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ status: '已退款' })]));
    expect(r.rows[0].type).toBe('INCOME');
  });

  it('零钱充值 → TRANSFER 到 微信', () => {
    // 支付方式为银行卡才不会被内部跳过
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ tradeType: '零钱充值', paymentMethod: '招商银行' })]));
    expect(r.rows[0].type).toBe('TRANSFER');
    expect(r.rows[0].toAccountName).toBe('微信');
  });

  it('零钱提现 → TRANSFER 到支付方式账户', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ tradeType: '零钱提现', paymentMethod: '招商银行' })]));
    expect(r.rows[0].type).toBe('TRANSFER');
    expect(r.rows[0].toAccountName).toBe('招商银行');
  });

  it('零钱→零钱(微信内部)转账被跳过', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ tradeType: '零钱充值', paymentMethod: '零钱' })]));
    expect(r.rows).toHaveLength(0);
  });

  it('空首单元格与 --- 分隔行被跳过', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, [''], wxRow({ paymentMethod: '招商银行' }), ['---分隔---'], ['', 'x']]));
    expect(r.rows).toHaveLength(1);
  });

  it('金额为 0 被跳过', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ amount: '0' })]));
    expect(r.rows).toHaveLength(0);
  });

  it('备注: 占位 / 字段不进备注,退款状态进备注', () => {
    const r = parseWechatXlsx(wechatXlsx([WX_HEADER, wxRow({ product: '/', status: '已全额退款', merchantNo: '/', remark: '/' })]));
    expect(r.rows[0].remark).toBe('状态:已全额退款 | 订单:10001');
  });
});

// ============ 京东 ============

/** 构造京东 CSV 文本 */
function jdCsv(rows: string[][], opts: { header?: string[]; preamble?: string[] } = {}): string {
  const header = opts.header ?? [
    '交易时间', '商户名称', '交易说明', '收/支', '金额', '收/付款方式', '交易状态', '交易分类', '交易订单号', '商家订单号', '备注',
  ];
  const lines = [...(opts.preamble ?? []), header.join(','), ...rows.map((r) => r.join(','))];
  return lines.join('\n');
}

const JD_ROW = {
  date: '2024-01-15 10:30:00',
  merchantName: '京东超市',
  description: '购买商品',
  direction: '支出',
  amount: '88.80',
  paymentMethod: '京东白条',
  status: '交易成功',
  category: '日用百货',
  orderNo: 'JD001',
  merchantOrderNo: 'JM001',
  remark: '',
};
const jdRow = (over: Partial<typeof JD_ROW> = {}): string[] => Object.values({ ...JD_ROW, ...over });

describe('parseJdCSV', () => {
  it('找不到表头行 → 报错', () => {
    const r = parseJdCSV(Buffer.from('京东交易流水\n无表头\n', 'utf8'));
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]).toContain('无法找到CSV表头行');
  });

  it('基本支出行(白条归一为 京东)', () => {
    const r = parseJdCSV(Buffer.from(jdCsv([jdRow()]), 'utf8'));
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.type).toBe('EXPENSE');
    expect(row.accountName).toBe('京东');
    expect(row.payer).toBe('京东超市');
    expect(row.categoryCode).toBe('日用百货');
    expect(row.tags).toEqual(['导入', '京东']);
  });

  it('GBK 编码正常解析', () => {
    const r = parseJdCSV(iconv.encode(jdCsv([jdRow({ paymentMethod: '招商银行' })]), 'gbk'));
    expect(r.rows[0].accountName).toBe('招商银行');
  });

  it('收入方向 → INCOME', () => {
    const r = parseJdCSV(Buffer.from(jdCsv([jdRow({ direction: '收入' })]), 'utf8'));
    expect(r.rows[0].type).toBe('INCOME');
  });

  it('不计收支 + 白条还款 → TRANSFER 到 京东', () => {
    const r = parseJdCSV(
      Buffer.from(jdCsv([jdRow({ direction: '不计收支', description: '白条主动还款', paymentMethod: '招商银行' })]), 'utf8'),
    );
    expect(r.rows[0].type).toBe('TRANSFER');
    expect(r.rows[0].toAccountName).toBe('京东');
  });

  it('不计收支 + 退款(状态或描述) → INCOME', () => {
    const a = parseJdCSV(Buffer.from(jdCsv([jdRow({ direction: '不计收支', status: '退款成功' })]), 'utf8'));
    expect(a.rows[0].type).toBe('INCOME');
    const b = parseJdCSV(Buffer.from(jdCsv([jdRow({ direction: '不计收支', description: '退款入账' })]), 'utf8'));
    expect(b.rows[0].type).toBe('INCOME');
  });

  it('不计收支 其余情况 → UNKNOWN', () => {
    const r = parseJdCSV(Buffer.from(jdCsv([jdRow({ direction: '不计收支' })]), 'utf8'));
    expect(r.rows[0].type).toBe('UNKNOWN');
  });

  it('白条→京东(内部)转账被跳过', () => {
    const r = parseJdCSV(
      Buffer.from(jdCsv([jdRow({ direction: '不计收支', description: '白条主动还款', paymentMethod: '京东白条' })]), 'utf8'),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('备注拼接:说明|商户|状态|订单|商户单|备注', () => {
    const r = parseJdCSV(Buffer.from(jdCsv([jdRow({ status: '退款成功', remark: '备注内容' })]), 'utf8'));
    expect(r.rows[0].remark).toBe('购买商品 | 商户:京东超市 | 状态:退款成功 | 订单:JD001 | 商户单:JM001 | 备注内容');
  });
});

// ============ 通用 CSV ============

describe('detectHeaderIndex', () => {
  it('表头在首行', () => {
    const lines = ['日期,金额,类型,账户,备注', '2024-01-15,25.00,支出,现金,午餐'];
    expect(detectHeaderIndex(lines)).toBe(0);
  });

  it('跳过前置标题行定位表头', () => {
    const lines = ['某记账App导出', '导出时间:2024-01-16', '日期,金额,类型,账户', '2024-01-15,25,支出,现金'];
    expect(detectHeaderIndex(lines)).toBe(2);
  });

  it('无有效表头返回 0', () => {
    const lines = ['一行普通文本', '另一行文本'];
    expect(detectHeaderIndex(lines)).toBe(0);
  });
});

describe('parseCsvWithMapping', () => {
  const mapping = {
    date: '日期', amount: '金额', type: '类型', account: '账户', toAccount: '目标账户', payer: '交易对方', category: '分类', remark: '备注',
  };

  const CSV_HEADER = '日期,金额,类型,账户,目标账户,交易对方,分类,备注';
  const csv = (dataLines: string[], opts: { preamble?: string[]; header?: string } = {}) =>
    [...(opts.preamble ?? []), opts.header ?? CSV_HEADER, ...dataLines].join('\n');

  it('按列名自动定位表头并解析', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15 10:30:00,25.50,支出,现金,,美团,餐饮,午餐'])),
      mapping,
      {},
    );
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.type).toBe('EXPENSE');
    expect(row.amount).toBe(25.5);
    expect(row.accountName).toBe('现金');
    expect(row.payer).toBe('美团');
    expect(row.categoryCode).toBe('餐饮');
    expect(row.remark).toBe('午餐');
    expect(row.tags).toEqual(['导入', 'CSV']);
  });

  it('找不到表头 → 报错', () => {
    const r = parseCsvWithMapping(Buffer.from('no,header,here'), mapping, {});
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]).toContain('无法定位CSV表头行');
  });

  it('手动指定表头行号', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15 10:30:00,25,支出,现金'], { preamble: ['导出说明', '第二行说明'] })),
      mapping,
      {},
      3,
    );
    expect(r.rows).toHaveLength(1);
  });

  it('表头行号超界 → 报错', () => {
    const r = parseCsvWithMapping(Buffer.from(csv([])), mapping, {}, 99);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]).toContain('超出文件总行数');
  });

  it('金额带货币符号与千分位被清洗(CSV 规范:含逗号字段加引号)', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15,"\u00a51,234.50",支出,现金'])),
      mapping,
      {},
    );
    expect(r.rows[0].amount).toBe(1234.5);
  });

  it('金额带全角货币符号与中文单位被清洗', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15,\uffe5 99.00元,支出,现金'])),
      mapping,
      {},
    );
    expect(r.rows[0].amount).toBe(99);
  });

  it('typeMapping 显式映射优先', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15,25,买,现金'])),
      mapping,
      { 买: 'EXPENSE' },
    );
    expect(r.rows[0].type).toBe('EXPENSE');
  });

  it('类型自动推断:收入/不计收支/未知值', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv([
        '2024-01-15,25,收入,现金',
        '2024-01-15,25,不计收支,现金',
        '2024-01-15,25,退款,现金',
      ])),
      mapping,
      {},
    );
    expect(r.rows.map((x) => x.type)).toEqual(['INCOME', 'TRANSFER', 'UNKNOWN']);
  });

  it('无类型列 → UNKNOWN,账户缺省为 导入账户', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15,25'], { header: '日期,金额' })),
      mapping,
      {},
    );
    expect(r.rows[0].type).toBe('UNKNOWN');
    expect(r.rows[0].accountName).toBe('导入账户');
  });

  it('转账带目标账户', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15,100,转账,现金,招商银行'])),
      mapping,
      {},
    );
    expect(r.rows[0].type).toBe('TRANSFER');
    expect(r.rows[0].toAccountName).toBe('招商银行');
  });

  it('日期无法解析 → 记入 errors', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['bad-date,25,支出,现金'])),
      mapping,
      {},
    );
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]).toContain('日期格式无法解析');
  });

  it('金额为 0 的行被跳过', () => {
    const r = parseCsvWithMapping(
      Buffer.from(csv(['2024-01-15,0,支出,现金'])),
      mapping,
      {},
    );
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });
});
