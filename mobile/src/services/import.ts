/**
 * 流水导入/导出服务 —— 对接 backend /api/records/import/* 与 /export。
 * 复刻 web 端 frontend/src/api/import-export.ts 的能力。
 */
import { Platform } from 'react-native';
import { http, uploadFileNative, getCredential, getBaseUrl, saveFileToSafDirectory, safDirLabel } from './http';
import { showToast } from '@/components/chrome/Toast';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// ── 类型(对齐 web api/import-export.ts) ──

export interface ParsedImportRow {
  date: string;
  type: string;
  amount: number;
  accountName?: string;
  accountId?: string | null;
  toAccountName?: string | null;
  toAccountId?: string | null;
  categoryCode?: string | null;
  mappedCategoryCode?: string | null;
  payer?: string | null;
  remark?: string | null;
  tags?: string[];
  rowIndex?: number;
  /** 服务端弱校验命中(同账户+同日+同金额+同方向已存在):提示用,不硬拦 */
  possibleDuplicate?: boolean;
}

export interface UnmatchedAccount {
  csvName: string;
  suggestedType: string;
  suggestedName: string;
  bankName?: string;
  accountNo?: string;
  /** 多候选(同名/包含匹配命中多个) */
  candidates?: { id: string; name: string }[];
}

export interface UnmatchedCategory {
  sourceCategory: string;
  suggestedCode: string | null;
  types: string[];
}

export interface DictEntry {
  code: string;
  label: string;
  group: string;
}

/** 阻断项(服务端 D 项):willFailAtImport=true 表示不处理必然失败 */
export interface PreviewBlockingItem {
  kind: 'account' | 'category' | 'unrecognized';
  ref: string;
  reason: string;
  willFailAtImport: boolean;
}

export interface ImportPreviewResult {
  records: ParsedImportRow[];
  unrecognizedRecords: ParsedImportRow[];
  unmatchedAccounts: UnmatchedAccount[];
  unmatchedCategories: UnmatchedCategory[];
  allDictItems: DictEntry[];
  accountMappings?: Record<string, string>;
  /** 阻断项:必然失败 / 会写脏数据的项 */
  blocking?: PreviewBlockingItem[];
  /** **服务端唯一裁决**:能否进入下一步 / 确认导入(前端直接采用) */
  canProceed?: boolean;
  /** canProceed 为 false 时的逐条原因 */
  blockReasons?: string[];
  /** 预览阶段会被跳过的行数 */
  skipped?: { unrecognized: number };
  /** C 项:应用全部决议后「实际会写入」的流水 */
  finalRecords?: ParsedImportRow[];
  /** C 项:未决清单 */
  unresolved?: { accounts: string[]; categories: string[]; unrecognized: number[] };
  /** C 项:进度计数(与 core computeImportProgress 同口径) */
  counts?: {
    accountsTotal: number;
    accountsResolved: number;
    accountsDefault: number;
    categoriesTotal: number;
    categoriesResolved: number;
    unrecognizedTotal: number;
    unrecognizedResolved: number;
    pending: number;
    mapped: number;
    willSkip: number;
    blocking: number;
  };
  stats: {
    totalRows: number;
    parsedRows: number;
    skippedRows: number;
    unrecognizedCount: number;
    errors: string[];
  };
}

export interface CsvAnalyzeResult {
  encoding: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export interface ImportConfirmPayload {
  accountBookId: string;
  source: string;
  records: {
    date: string;
    type: string;
    amount: number;
    accountId: string;
    toAccountId?: string;
    categoryCode?: string | null;
    payer?: string | null;
    remark?: string;
    tags?: string[];
    ownerId?: string;
  }[];
  accountCreations?: { csvName: string; name: string; type: string; bankName?: string; accountNo?: string; ownerId?: string }[];
  newMappings?: { sourceCategory: string; payerContains?: string; descriptionContains?: string; recordType?: string; targetCategoryCode: string }[];
  /** 跳过的未识别行数 + 显式确认(服务端校验:>0 且未确认则 400) */
  skippedUnrecognized?: number;
  confirmSkipUnrecognized?: boolean;
  newAccountMappings?: { sourceAccountName: string; targetAccountName: string; payerContains?: string; descriptionContains?: string }[];
}

// ── 文件上传 ──

/**
 * 账单文件白名单(按扩展名)。
 *
 * 系统文件选择器**不要**按 MIME 过滤:Android SAF 对 CSV 报告的 MIME 五花八门
 * (text/plain、application/octet-stream、text/comma-separated-values…),只声明 `text/csv`
 * 会让 CSV 在文件管理器里直接不可见/不可选。改为放开选择 + 选完用这个白名单校验。
 */
const BILL_FILE_EXTENSIONS = ['.csv', '.xls', '.xlsx'];
export function isBillFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return BILL_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 按来源推断上传文件的 MIME(wechat 为 xlsx,其余 csv) */
export function guessImportMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'text/csv';
}

/**
 * 上传账单文件。服务端把它落成一个**附件**并返回 attachmentId —— AI 侧统一只认 attachmentId,不再有 fileId。
 * url 用于本地回显该消息的附件 chip。
 */
export function uploadImportFile(fileUri: string, fileName: string): Promise<{ attachmentId: string; url: string; filename: string; size: number }> {
  return uploadFileNative(`${getBaseUrl()}/api/records/import/upload`, fileUri, guessImportMime(fileName));
}

/** 分析 CSV:返回表头/样本/行数(其他CSV 来源的列映射用) */
export function analyzeImportCsv(fileUri: string, fileName: string, headerRow?: number): Promise<CsvAnalyzeResult> {
  return uploadFileNative<CsvAnalyzeResult>(
    `${getBaseUrl()}/api/records/import/csv/analyze`,
    fileUri,
    guessImportMime(fileName),
    headerRow !== undefined ? { headerRow: String(headerRow) } : undefined,
  );
}

/** 解析预览:alipay/wechat/jd 内置解析;csv 必须带 columnMapping/typeMapping */
export function previewImport(
  fileUri: string,
  fileName: string,
  params: {
    source: string;
    accountBookId: string;
    columnMapping?: Record<string, string>;
    typeMapping?: Record<string, string>;
    headerRow?: number;
    /** C 项:第二步带上当前决议,让服务端按同一条流程重算 */
    resolutions?: {
      ownerId?: string;
      accountResolutions?: unknown[];
      categoryResolutions?: unknown[];
      unrecognizedResolutions?: unknown[];
      /** 是否已同意跳过未处置的未识别行(服务端裁决需要) */
      confirmSkipUnrecognized?: boolean;
    };
  },
): Promise<ImportPreviewResult> {
  const fields: Record<string, string> = {
    source: params.source,
    accountBookId: params.accountBookId,
  };
  if (params.columnMapping) fields.columnMapping = JSON.stringify(params.columnMapping);
  if (params.typeMapping) fields.typeMapping = JSON.stringify(params.typeMapping);
  if (params.headerRow !== undefined) fields.headerRow = String(params.headerRow);
  if (params.resolutions) {
    const r = params.resolutions;
    if (r.ownerId) fields.ownerId = r.ownerId;
    if (r.accountResolutions?.length) fields.accountResolutions = JSON.stringify(r.accountResolutions);
    if (r.categoryResolutions?.length) fields.categoryResolutions = JSON.stringify(r.categoryResolutions);
    if (r.unrecognizedResolutions?.length) fields.unrecognizedResolutions = JSON.stringify(r.unrecognizedResolutions);
    if (r.confirmSkipUnrecognized) fields.confirmSkipUnrecognized = 'true';
  }
  return uploadFileNative<ImportPreviewResult>(
    `${getBaseUrl()}/api/records/import/preview`,
    fileUri,
    guessImportMime(fileName),
    fields,
  );
}

/**
 * AI 卡片用:按当前决议校验能否导入(**不执行**),与手动向导的「下一步」是同一道服务端裁决。
 * 未通过就停在卡片上让用户处理或勾选「同意跳过」。
 */
export async function checkImport(data: {
  accountBookId: string;
  attachmentId: string;
  ownerId?: string;
  confirmSkipUnrecognized?: boolean;
  accountResolutions?: unknown[];
  categoryResolutions?: unknown[];
  unrecognizedResolutions?: unknown[];
}): Promise<{ canProceed: boolean; blockReasons: string[]; finalCount: number; skippedUnrecognized: number }> {
  return http.post('/api/records/import/check', data);
}

// ── 确认导入 ──

export async function confirmImport(payload: ImportConfirmPayload): Promise<{ imported: number; accountsCreated: number; ids?: string[] }> {
  const res = await http.post<{ imported: number; accountsCreated: number; ids?: string[] }>('/api/records/import', payload);
  return res ?? { imported: 0, accountsCreated: 0 };
}

// ── 导出 CSV ──

export interface ExportFilters {
  bookId: string;
  types?: string[];
  accountIds?: string[];
  /** 转账的转入账户(与列表筛选同口径) */
  toAccountIds?: string[];
  categoryCodes?: string[];
  dateFrom?: string;
  dateTo?: string;
}

/** 导出方式:save=SAF 保存到授权目录(仅 Android,iOS 回退分享);share=系统分享面板 */
export type ExportMode = 'save' | 'share';

/** 按当前筛选导出流水 CSV,mode 决定落盘方式(UI 层弹窗选择) */
export async function exportRecordsCsv(filters: ExportFilters, mode: ExportMode): Promise<void> {
  const cred = await getCredential();
  if (!cred) throw new Error('请先配置服务器并登录');
  const qs = new URLSearchParams();
  qs.set('bookId', filters.bookId);
  if (filters.types?.length) qs.set('type', filters.types.join(','));
  if (filters.accountIds?.length) qs.set('accountId', filters.accountIds.join(','));
  if (filters.toAccountIds?.length) qs.set('toAccountId', filters.toAccountIds.join(','));
  if (filters.categoryCodes?.length) qs.set('categoryCode', filters.categoryCodes.join(','));
  if (filters.dateFrom) qs.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) qs.set('dateTo', filters.dateTo);

  const url = `${getBaseUrl()}/api/records/export?${qs.toString()}`;
  const fileName = `records_export_${new Date().toISOString().slice(0, 10)}.csv`;
  const res = await downloadToCache(url, fileName, cred.value);
  if (res.status < 200 || res.status >= 300) throw new Error(`导出失败(${res.status})`);

  if (mode === 'save' && Platform.OS === 'android') {
    // SAF 直接写入不支持同名覆盖,文件名加时分秒避免冲突
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const saveName = `records_export_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
    const dirUri = await saveFileToSafDirectory(res.uri, saveName, 'text/csv');
    if (dirUri) showToast(`导出成功,已保存到 ${safDirLabel(dirUri)}`);
    return;
  }
  await shareDownloadedFile(res.uri, fileName);
}

// ── 下载/分享(与 http.ts downloadAndShareAttachment 同机制,支持任意 URL) ──

async function downloadToCache(url: string, fileName: string, token: string): Promise<{ status: number; uri: string }> {
  return FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${fileName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function shareDownloadedFile(uri: string, fileName: string): Promise<void> {
  const ok = await Sharing.isAvailableAsync();
  if (!ok) throw new Error('当前环境不支持保存文件');
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: fileName });
}
