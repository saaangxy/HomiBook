// 备份/恢复 模块定义与顺序常量
// 一个"模块"对应前端勾选项；每个模块可能包含多张表（一个表一个 JSON 文件）

/** 核心模块（导出时强制包含，不可取消） */
export const CORE_MODULES = [
  'systemConfig',
  'user',
  'accountBook',
  'account',
  'record',
] as const

export interface ModuleOption {
  key: string
  label: string
  core: boolean
  /** 是否按所选账本过滤（账本域数据）；全局数据（系统配置/字典/用户等）不受账本过滤 */
  bookScoped: boolean
}

/** 前端模块勾选清单（顺序即显示顺序） */
export const MODULE_OPTIONS: ModuleOption[] = [
  { key: 'systemConfig', label: '系统配置', core: true, bookScoped: false },
  { key: 'dictionary', label: '字典', core: false, bookScoped: false },
  { key: 'holiday', label: '节假日', core: false, bookScoped: false },
  { key: 'user', label: '用户', core: true, bookScoped: false },
  { key: 'accountBook', label: '账本', core: true, bookScoped: true },
  { key: 'account', label: '账户', core: true, bookScoped: true },
  { key: 'record', label: '流水', core: true, bookScoped: true },
  { key: 'budget', label: '预算', core: false, bookScoped: true },
  { key: 'recurring', label: '固定收支', core: false, bookScoped: true },
  { key: 'importMapping', label: '导入映射', core: false, bookScoped: false },
  { key: 'aiConfig', label: 'AI 助手配置', core: false, bookScoped: false },
  { key: 'aiChat', label: 'AI 聊天记录', core: false, bookScoped: true },
  { key: 'apiKey', label: 'API Key', core: false, bookScoped: false },
  { key: 'attachments', label: '附件（含文件）', core: false, bookScoped: true },
]

/** 模块 → 数据表文件（不含 .json 后缀，与 Prisma model 名一致） */
export const MODULE_FILES: Record<string, string[]> = {
  systemConfig: ['systemConfig'],
  dictionary: ['dictionary'],
  holiday: ['holiday'],
  user: ['user'],
  accountBook: ['accountBook', 'accountBookMember', 'shareCode'],
  account: ['account', 'balanceAdjustment'],
  record: ['record'],
  budget: ['budget'],
  recurring: ['recurringTransaction', 'repaymentPlan'],
  importMapping: ['importCategoryMapping', 'importAccountMapping'],
  aiConfig: ['userAIConfig', 'userProviderConfig'],
  aiChat: ['chatSession', 'chatMessage', 'userMemory', 'agentAuditLog'],
  apiKey: ['apiKey'],
  attachments: ['recordAttachment'],
}

/**
 * 导入（覆盖恢复）时的数据表插入顺序，也是依赖拓扑序：
 * 子表依赖的父表必须先插入。删除时按此数组逆序进行（子表先删）。
 */
export const IMPORT_TABLE_ORDER = [
  'user',
  'systemConfig',
  'dictionary',
  'holiday',
  'accountBook',
  'accountBookMember',
  'shareCode',
  'account',
  'balanceAdjustment',
  'record',
  'recordAttachment',
  'budget',
  'recurringTransaction',
  'repaymentPlan',
  'importCategoryMapping',
  'importAccountMapping',
  'userAIConfig',
  'userProviderConfig',
  'apiKey',
  'chatSession',
  'chatMessage',
  'userMemory',
  'agentAuditLog',
] as const

/** 备份文件格式版本（导入时校验） */
export const BACKUP_FORMAT_VERSION = 1

/** 外键关系：表 -> [{列名, 引用表, 是否可空}]。导入前用于清理孤儿行 */
export interface ForeignKey {
  column: string
  refTable: string
  nullable: boolean
}

export const FOREIGN_KEYS: Record<string, ForeignKey[]> = {
  accountBook: [{column: 'ownerId', refTable: 'user', nullable: false}],
  accountBookMember: [
    {column: 'accountBookId', refTable: 'accountBook', nullable: false},
    {column: 'userId', refTable: 'user', nullable: false},
  ],
  account: [
    {column: 'accountBookId', refTable: 'accountBook', nullable: false},
    {column: 'ownerId', refTable: 'user', nullable: false},
  ],
  balanceAdjustment: [{column: 'accountId', refTable: 'account', nullable: false}],
  record: [
    {column: 'accountBookId', refTable: 'accountBook', nullable: false},
    {column: 'ownerId', refTable: 'user', nullable: false},
    {column: 'accountId', refTable: 'account', nullable: false},
    {column: 'fromAccountId', refTable: 'account', nullable: true},
    {column: 'toAccountId', refTable: 'account', nullable: true},
  ],
  recordAttachment: [{column: 'recordId', refTable: 'record', nullable: true}],
  shareCode: [{column: 'accountBookId', refTable: 'accountBook', nullable: false}],
  budget: [{column: 'accountBookId', refTable: 'accountBook', nullable: false}],
  recurringTransaction: [
    {column: 'accountBookId', refTable: 'accountBook', nullable: false},
    {column: 'accountId', refTable: 'account', nullable: false},
    {column: 'toAccountId', refTable: 'account', nullable: true},
    {column: 'ownerId', refTable: 'user', nullable: false},
  ],
  repaymentPlan: [{column: 'recurringTransactionId', refTable: 'recurringTransaction', nullable: false}],
  apiKey: [{column: 'userId', refTable: 'user', nullable: false}],
  chatSession: [
    {column: 'userId', refTable: 'user', nullable: false},
    {column: 'accountBookId', refTable: 'accountBook', nullable: true},
  ],
  chatMessage: [
    {column: 'sessionId', refTable: 'chatSession', nullable: false},
    {column: 'accountBookId', refTable: 'accountBook', nullable: true},
  ],
  userMemory: [
    {column: 'userId', refTable: 'user', nullable: false},
    {column: 'sessionId', refTable: 'chatSession', nullable: true},
  ],
  userAIConfig: [{column: 'userId', refTable: 'user', nullable: false}],
  userProviderConfig: [{column: 'userId', refTable: 'user', nullable: false}],
  agentAuditLog: [
    {column: 'sessionId', refTable: 'chatSession', nullable: true},
    {column: 'userId', refTable: 'user', nullable: false},
  ],
}

/**
 * 清理孤儿行：检查所有外键引用，引用不存在时：
 * - 非空外键：跳过整行
 * - 可空外键：置为 null
 * 就地修改 tables 对象，返回跳过的行数。
 */
export function sanitizeTablesData(tables: Record<string, any[]>): number {
  // 构建每张表的 id 集合
  const ids: Record<string, Set<string>> = {}
  for (const table of IMPORT_TABLE_ORDER) {
    ids[table] = new Set((tables[table] || []).map((r) => r.id).filter(Boolean))
  }

  let skipped = 0
  for (const table of IMPORT_TABLE_ORDER) {
    const fks = FOREIGN_KEYS[table]
    if (!fks || !tables[table]) continue
    const before = tables[table].length
    if (before === 0) continue
    tables[table] = tables[table]
      .map((row) => {
        const cleaned = {...row}
        for (const fk of fks) {
          const val = cleaned[fk.column]
          if (!val) continue
          if (!ids[fk.refTable]?.has(val)) {
            if (fk.nullable) {
              cleaned[fk.column] = null
            } else {
              return null
            }
          }
        }
        return cleaned
      })
      .filter((r): r is any => r !== null)
    skipped += before - tables[table].length
  }

  return skipped
}

/**
 * 校验模块清单：全部为合法模块 key。
 * 核心数据为整体打包：要么包含全部核心模块，要么一个都不含（允许只导出非核心）。
 * 不允许出现"部分核心模块"的情况。
 */
export function assertValidModules(modules: string[]) {
  const validKeys = new Set(MODULE_OPTIONS.map((m) => m.key))
  for (const key of modules) {
    if (!validKeys.has(key)) {
      throw Object.assign(new Error(`未知模块: ${key}`), { statusCode: 400 })
    }
  }
  const hasAnyCore = CORE_MODULES.some((c) => modules.includes(c))
  if (hasAnyCore) {
    for (const core of CORE_MODULES) {
      if (!modules.includes(core)) {
        throw Object.assign(new Error(`核心数据必须整体打包导出，缺少: ${core}`), { statusCode: 400 })
      }
    }
  }
}
