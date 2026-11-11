import { describe, expect, it } from 'vitest';
import {
  CORE_MODULES,
  FOREIGN_KEYS,
  IMPORT_TABLE_ORDER,
  MODULE_FILES,
  assertValidModules,
} from '../src/services/backup/modules.js';

const order = IMPORT_TABLE_ORDER as readonly string[];
const idx = (table: string) => order.indexOf(table);

describe('备份表定义', () => {
  it('聊天消息-附件关联随 AI 聊天模块导出', () => {
    expect(MODULE_FILES.aiChat).toContain('chatMessageAttachment');
  });

  it('关联表插入顺序在 recordAttachment 与 chatMessage 之后', () => {
    expect(idx('chatMessageAttachment')).toBeGreaterThan(idx('recordAttachment'));
    expect(idx('chatMessageAttachment')).toBeGreaterThan(idx('chatMessage'));
  });

  it('关联两侧外键均非空：缺附件时整行跳过而不是恢复坏引用', () => {
    const fks = FOREIGN_KEYS.chatMessageAttachment ?? [];
    expect(fks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'messageId', refTable: 'chatMessage', nullable: false }),
        expect.objectContaining({ column: 'attachmentId', refTable: 'recordAttachment', nullable: false }),
      ]),
    );
  });

  it('recordAttachment 不再声明已删除的 recordId 外键', () => {
    expect(FOREIGN_KEYS.recordAttachment).toBeUndefined();
  });
});

describe('assertValidModules', () => {
  it('AI 聊天记录必须同时包含附件模块', () => {
    expect(() => assertValidModules([...CORE_MODULES, 'aiChat'])).toThrow(/附件/);
    expect(() => assertValidModules([...CORE_MODULES, 'aiChat', 'attachments'])).not.toThrow();
  });

  it('不含聊天记录时不强制附件', () => {
    expect(() => assertValidModules([...CORE_MODULES, 'budget'])).not.toThrow();
  });
});

