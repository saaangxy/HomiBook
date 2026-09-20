import { PermissionsAndroid, Platform } from 'react-native';
import TxnReader, {
  type ListSmsOptions,
  type NativeNotificationRecord,
  type NativeSmsRecord,
} from '../../modules/txn-reader';

// 短信/通知采集(仅 Android):原生模块 + 运行时权限 + 平台降级。
// 分层:本文件只负责「拿到原始短信文本/权限状态」;是否交易、字段提取在 core 的 sms-parse。

export type { NativeSmsRecord, NativeNotificationRecord, ListSmsOptions };

/** 平台是否支持(仅 Android;iOS 无公开短信 API) */
export const isTxnReaderSupported = Platform.OS === 'android' && !!TxnReader;

/** 短信读取权限是否已授予 */
export function hasSmsPermission(): boolean {
  return !!TxnReader && TxnReader.hasSmsPermission();
}

/**
 * 申请短信读取权限。权限申请交给 React Native PermissionsAndroid(原生侧只报告状态),
 * 需在 app.json 声明 android.permission.READ_SMS,否则系统会直接拒绝。
 */
export async function requestSmsPermission(): Promise<boolean> {
  if (!TxnReader) return false;
  if (TxnReader.hasSmsPermission()) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: '读取短信以自动记账',
    message: '仅在本机解析银行/支付短信中的交易信息;关闭「上送 AI 分类」后短信正文不会离开设备。',
    buttonPositive: '允许',
    buttonNegative: '暂不',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** 回溯扫描收件箱短信(需已授权);只返回原始记录,不在此处预筛 */
export async function listSms(options: ListSmsOptions = {}): Promise<NativeSmsRecord[]> {
  if (!TxnReader) return [];
  return TxnReader.listSms(options);
}

/** 通知使用权是否已开启:开启后本应用才能收到银行/支付 App 的通知(系统不提供历史通知) */
export function isNotificationAccessGranted(): boolean {
  return !!TxnReader && TxnReader.isNotificationAccessGranted();
}

/** 跳转系统「通知使用权」设置页(需用户在列表里手动勾选本应用) */
export function openNotificationAccessSettings(): void {
  TxnReader?.openNotificationAccessSettings();
}

/**
 * 跳转「本应用的权限管理」页:小米 / 红米在这里允许「通知类短信」。
 * 该权限不是 AOSP 运行时权限(READ_SMS 只覆盖普通短信),应用无法申请也无法检测,
 * 唯一办法是引导用户手动开 —— 否则短信库里只有个人短信,扫不到银行流水。
 */
export function openSmsPermissionSettings(): void {
  TxnReader?.openSmsPermissionSettings();
}

/**
 * 读取通知累积队列。系统不提供通知历史,只有开启使用权之后到达的通知会被采集。
 * clear=true 时读完清空(默认保留,由「已处理」标记去重,避免未导入的通知丢失)。
 */
export async function getPendingNotifications(options: { clear?: boolean } = {}): Promise<NativeNotificationRecord[]> {
  if (!TxnReader) return [];
  return TxnReader.getPendingNotifications(options);
}

/** 清空通知队列(设置页「清空本机标记」用) */
export function clearPendingNotifications(): void {
  TxnReader?.clearPendingNotifications();
}

/**
 * 按 key 移除队列里的若干条:导入成功后调用,把已入账(含跨渠道折叠掉的重复来源)的通知清掉。
 * 不清的话它们只靠「已处理」标记在扫描阶段跳过,标记一清就又冒出来。
 */
export async function removePendingNotifications(keys: string[]): Promise<void> {
  if (!TxnReader || keys.length === 0) return;
  await TxnReader.removePendingNotifications(keys);
}
