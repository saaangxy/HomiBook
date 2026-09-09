import { describe, expect, it } from 'vitest';
import { buildImportMessage, parseImportMessage } from '../src/ai/import-message.js';

describe('buildImportMessage', () => {
  it('已知来源使用展示标签', () => {
    expect(buildImportMessage({ fileId: 'f123', source: 'alipay', fileName: '账单.csv' })).toBe(
      '请导入支付宝账单文件\nfileId: f123\nsource: alipay\n文件名: 账单.csv',
    );
  });

  it('未知来源回退原始 key', () => {
    expect(buildImportMessage({ fileId: 'f1', source: 'bank', fileName: 'a.csv' })).toContain(
      '请导入bank账单文件',
    );
  });
});

describe('parseImportMessage', () => {
  it('编码/解码 roundtrip:已知来源解码为展示标签', () => {
    const text = buildImportMessage({ fileId: 'f123', source: 'alipay', fileName: '账单.csv' });
    expect(parseImportMessage(text)).toEqual({
      desc: '请导入支付宝账单文件',
      fileName: '账单.csv',
      source: '支付宝',
    });
  });

  it('未知来源 roundtrip:标签与 key 相同', () => {
    const text = buildImportMessage({ fileId: 'f1', source: 'bank', fileName: 'a.csv' });
    expect(parseImportMessage(text)).toEqual({ desc: '请导入bank账单文件', fileName: 'a.csv', source: 'bank' });
  });

  it('非导入消息返回 null', () => {
    expect(parseImportMessage('普通聊天消息')).toBeNull();
    expect(parseImportMessage('')).toBeNull();
    expect(parseImportMessage('请导入支付宝账单文件\nfileId: f123')).toBeNull();
  });

  it('容忍各段周围空白', () => {
    const text = ' 请导入微信账单文件 \nfileId:  x1 \nsource: wechat \n文件名: b.xlsx ';
    expect(parseImportMessage(text)).toEqual({
      desc: '请导入微信账单文件',
      fileName: 'b.xlsx',
      source: '微信',
    });
  });

  it('描述段可含换行', () => {
    const text = '第一行\n第二行\nfileId: f1\nsource: csv\n文件名: c.csv';
    expect(parseImportMessage(text)?.desc).toBe('第一行\n第二行');
  });

  it('文件名允许包含空格', () => {
    const text = '请导入账单\nfileId: f1\nsource: csv\n文件名: my bill.csv';
    expect(parseImportMessage(text)?.fileName).toBe('my bill.csv');
  });

  it('尾部换行不影响解析', () => {
    const text = buildImportMessage({ fileId: 'f1', source: 'jd', fileName: 'j.csv' }) + '\n';
    expect(parseImportMessage(text)?.fileName).toBe('j.csv');
  });
});
