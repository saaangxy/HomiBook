import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyShort } from '../src/format.js';

describe('formatMoney', () => {
  it('正数:¥前缀 + 千分位 + 两位小数', () => {
    expect(formatMoney(1234.5)).toBe('¥1,234.50');
  });

  it('整数补齐两位小数', () => {
    expect(formatMoney(100)).toBe('¥100.00');
  });

  it('零', () => {
    expect(formatMoney(0)).toBe('¥0.00');
  });

  it('负数:负号在¥之前,按绝对值格式化', () => {
    expect(formatMoney(-9876.543)).toBe('-¥9,876.54');
  });

  it('千分位进位', () => {
    expect(formatMoney(999999.999)).toBe('¥1,000,000.00');
  });
});

describe('formatMoneyShort', () => {
  it('万以下:千分位,无小数', () => {
    expect(formatMoneyShort(9999)).toBe('¥9,999');
    expect(formatMoneyShort(0)).toBe('¥0');
  });

  it('达到万:万单位 + 一位小数', () => {
    expect(formatMoneyShort(10000)).toBe('¥1.0万');
    expect(formatMoneyShort(123456)).toBe('¥12.3万');
  });

  it('负数', () => {
    expect(formatMoneyShort(-10000)).toBe('-¥1.0万');
    expect(formatMoneyShort(-500)).toBe('-¥500');
  });
});
