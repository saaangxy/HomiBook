/**
 * 流水导入/导出服务 —— 对接 backend /api/records/import/* 与 /export。
 * 复刻 web 端 frontend/src/api/import-export.ts 的能力。
 */
import { Platform } from 'react-native';
import { http, uploadFileNative, getCredential, getBaseUrl } from './http';
import { secureGet, secureSet, secureDelete } from './storage';
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

export interface ImportPreviewResult {
  records: ParsedImportRow[];
  unrecognizedRecords: ParsedImportRow[];
  unmatchedAccounts: UnmatchedAccount[];
  unmatchedCategories: UnmatchedCategory[];
  allDictItems: DictEntry[];
  accountMappings?: Record<string, string>;
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
  newAccountMappings?: { sourceAccountName: string; targetAccountName: string; payerContains?: string; descriptionContains?: string }[];
}

// ── 文件上传 ──

/** 按来源推断上传文件的 MIME(wechat 为 xlsx,其余 csv) */
export function guessImportMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'text/csv';
}

/** 上传账单文件到临时存储(AI 导入与手动导入共用) */
export function uploadImportTempFile(fileUri: string, fileName: string): Promise<{ fileId: string; filename: string; size: number }> {
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
  },
): Promise<ImportPreviewResult> {
  const fields: Record<string, string> = {
    source: params.source,
    accountBookId: params.accountBookId,
  };
  if (params.columnMapping) fields.columnMapping = JSON.stringify(params.columnMapping);
  if (params.typeMapping) fields.typeMapping = JSON.stringify(params.typeMapping);
  if (params.headerRow !== undefined) fields.headerRow = String(params.headerRow);
  return uploadFileNative<ImportPreviewResult>(
    `${getBaseUrl()}/api/records/import/preview`,
    fileUri,
    guessImportMime(fileName),
    fields,
  );
}

// ── 确认导入 ──

export async function confirmImport(payload: ImportConfirmPayload): Promise<{ imported: number; accountsCreated: number }> {
  const res = await http.post<{ imported: number; accountsCreated: number }>('/api/records/import', payload);
  return res ?? { imported: 0, accountsCreated: 0 };
}

// ── 导出 CSV ──

export interface ExportFilters {
  bookId: string;
  types?: string[];
  accountIds?: string[];
  categoryCodes?: string[];
  dateFrom?: string;
  dateTo?: string;
}

/** 记住的 SAF 授权目录(Android 导出用) */
const EXPORT_DIR_KEY = 'homibook.exportDirUri';

/** SAF 目录 URI 转可读路径(内置存储 provider 解析为「内部存储/xx」,其他展示 tree 段) */
function safDirLabel(uri: string): string {
  const tree = uri.split('/tree/')[1];
  if (!tree) return uri;
  const seg = decodeURIComponent(tree.split('/')[0]);
  if (uri.includes('externalstorage.documents') && seg.startsWith('primary:')) {
    const path = seg.slice('primary:'.length);
    return path ? `内部存储/${path}` : '内部存储';
  }
  return seg || uri;
}

/**
 * SAF 写入用户授权的目录(首次弹出目录选择器,授权后记住,之后直接写入)。
 * 授权失效时自动清除记录并重新请求;返回写入的目录 URI,用户取消返回 null。
 */
async function saveCsvToDirectory(cacheUri: string, fileName: string): Promise<string | null> {
  const content = await FileSystem.readAsStringAsync(cacheUri, { encoding: FileSystem.EncodingType.Base64 });
  let dirUri = await secureGet(EXPORT_DIR_KEY);
  if (!dirUri) {
    const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) return null;
    dirUri = perms.directoryUri;
    await secureSet(EXPORT_DIR_KEY, dirUri);
  }
  try {
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(dirUri, fileName, 'text/csv');
    await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.Base64 });
    return dirUri;
  } catch {
    // 授权可能已失效:清除记录重新授权一次
    await secureDelete(EXPORT_DIR_KEY);
    const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) return null;
    await secureSet(EXPORT_DIR_KEY, perms.directoryUri);
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perms.directoryUri, fileName, 'text/csv');
    await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.Base64 });
    return perms.directoryUri;
  }
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
    const dirUri = await saveCsvToDirectory(res.uri, saveName);
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
