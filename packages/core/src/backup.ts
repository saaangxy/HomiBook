// 备份 / 恢复的模块清单 —— 前后端共用一份，避免新增模块时两边不同步

/** 备份模块勾选项 */
export interface BackupModuleOption {
  key: string;
  label: string;
  /** 核心模块：导出时强制包含，不可单独取消 */
  core: boolean;
  /** 是否按所选账本过滤（账本域数据）；全局数据（系统配置/字典/用户等）不受账本过滤 */
  bookScoped: boolean;
}

/** 核心模块 key（导出时强制包含） */
export const CORE_MODULE_KEYS = [
  'systemConfig',
  'user',
  'accountBook',
  'account',
  'record',
] as const;

/** 模块勾选清单（顺序即显示顺序） */
export const BACKUP_MODULES: BackupModuleOption[] = [
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
];
