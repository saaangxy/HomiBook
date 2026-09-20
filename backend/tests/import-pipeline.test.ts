import { describe, expect, it } from 'vitest';
import { existingRecordKey } from '../src/services/import/pipeline.js';

// 弱校验键(第 3 层去重):同账户 + 同一业务日 + 同金额 + 同方向。
// 断言只做「相同/不同」的关系判断,不写死具体日期字符串 —— dateKey 走业务时区,写死会在非 +08:00 环境误报。

describe('existingRecordKey', () => {
  const base = () => existingRecordKey('acc1', '2026-09-17T04:58:00.000Z', 100, 'EXPENSE');

  it('同账户同日同额同方向 → 同键(不同时刻也算同一天)', () => {
    const anotherMoment = existingRecordKey('acc1', '2026-09-17T05:30:00.000Z', 100, 'EXPENSE');
    expect(anotherMoment).toBe(base());
  });

  it('账户 / 金额 / 方向 / 日期 任一不同 → 不同键', () => {
    expect(existingRecordKey('acc2', '2026-09-17T04:58:00.000Z', 100, 'EXPENSE')).not.toBe(base());
    expect(existingRecordKey('acc1', '2026-09-17T04:58:00.000Z', 101, 'EXPENSE')).not.toBe(base());
    expect(existingRecordKey('acc1', '2026-09-17T04:58:00.000Z', 100, 'INCOME')).not.toBe(base());
    // 相差两天:任何时区都不可能同一天
    expect(existingRecordKey('acc1', '2026-09-19T04:58:00.000Z', 100, 'EXPENSE')).not.toBe(base());
  });

  it('金额按两位小数归一(100 与 100.00 等价)', () => {
    expect(existingRecordKey('acc1', '2026-09-17T04:58:00.000Z', 100, 'EXPENSE')).toBe(
      existingRecordKey('acc1', '2026-09-17T04:58:00.000Z', 100.0, 'EXPENSE'),
    );
  });

  it('接受 Date 与 ISO 字符串两种入参', () => {
    expect(existingRecordKey('acc1', new Date('2026-09-17T04:58:00.000Z'), 100, 'EXPENSE')).toBe(base());
  });

  it('非法日期不抛错(键里日期段留空)', () => {
    expect(() => existingRecordKey('acc1', 'not-a-date', 100, 'EXPENSE')).not.toThrow();
    expect(existingRecordKey('acc1', 'not-a-date', 100, 'EXPENSE')).toContain('|100.00|EXPENSE');
  });
});
