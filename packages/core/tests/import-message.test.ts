import { describe, expect, it } from 'vitest';
import { buildImportMessage, parseImportMessage, IMPORT_MESSAGE_PREFIX } from '../src/ai/import-message.js';

describe('buildImportMessage', () => {
  it('只发一句自然语言请求:不再编码 fileId/source/文件名', () => {
    const text = buildImportMessage({ source: 'alipay' });
    expect(text).toBe('请导入支付宝账单文件');
    // 带了元数据行就又会被当成 v1 协议渲染出文件卡片,而模型也会以为要抄 id
    expect(text).not.toContain('fileId');
    expect(text).not.toContain('source');
    expect(parseImportMessage(text)).toBeNull();
  });

  it('未知来源回退原始 key', () => {
    expect(buildImportMessage({ source: 'bank' })).toContain('请导入bank账单文件');
  });

  it('前缀常量与消息一致(后端技能检测靠它识别导入请求)', () => {
    expect(buildImportMessage({ source: 'wechat' }).startsWith(IMPORT_MESSAGE_PREFIX)).toBe(true);
  });
});

describe('parseImportMessage(仅用于兼容旧会话里的 v1 协议)', () => {
  it('解出元数据,来源映射为展示标签', () => {
    const text = '请导入支付宝账单文件\nfileId: f123\nsource: alipay\n文件名: 账单.csv';
    expect(parseImportMessage(text)).toEqual({
      desc: '请导入支付宝账单文件',
      fileName: '账单.csv',
      source: '支付宝',
    });
  });

  it('非导入消息返回 null', () => {
    expect(parseImportMessage('普通聊天消息')).toBeNull();
    expect(parseImportMessage('')).toBeNull();
    expect(parseImportMessage('请导入支付宝账单文件')).toBeNull();
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
    const text = '请导入京东账单文件\nfileId: f1\nsource: jd\n文件名: j.csv\n';
    expect(parseImportMessage(text)?.fileName).toBe('j.csv');
  });
});
