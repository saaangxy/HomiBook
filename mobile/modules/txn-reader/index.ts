import { requireOptionalNativeModule } from 'expo-modules-core';

// txn-reader:Android 短信/通知采集原生模块(见 android/src/main/java/expo/modules/txnreader)。
// iOS / Web 上不存在 → requireOptionalNativeModule 返回 null,由 services/txn-reader.ts 统一降级。

/** 收件箱短信(原生投影字段,未做任何业务解析) */
export interface NativeSmsRecord {
  /** 短信 _id(去重与「已处理」标记用) */
  id: string;
  /** 发送号码 */
  address: string | null;
  body: string;
  /** 到达时刻(ms epoch) */
  date: number;
  /** 1=收件箱(listSms 只返回收件箱) */
  type: number;
}

export interface ListSmsOptions {
  /** 起始时间(ms epoch,含) */
  start?: number;
  /** 结束时间(ms epoch,含) */
  end?: number;
  /** 上限,默认 500、最大 2000 */
  limit?: number;
}

/** 通知渠道累积记录(BankNotificationListener 落在本机队列里的一条) */
export interface NativeNotificationRecord {
  /** 通知 key(系统更新同一条通知时保持不变) */
  key: string;
  /** 应用包名 */
  pkg: string;
  /** 白名单里的来源展示名(如「招商银行」),用于银行名兜底 */
  source: string;
  title: string;
  text: string;
  /** 到达时刻(ms epoch) */
  postedAt: number;
}

export interface TxnReaderNativeModule {
  /** READ_SMS 是否已授权(同步) */
  hasSmsPermission(): boolean;
  /** 收件箱短信按时间倒序 */
  listSms(options: ListSmsOptions): Promise<NativeSmsRecord[]>;
  /** 通知使用权是否已开启(银行/支付 App 通知渠道用) */
  isNotificationAccessGranted(): boolean;
  /** 跳转「本应用的权限管理」页(小米/红米:在那里允许「通知类短信」) */
  openSmsPermissionSettings(): void;
  /** 跳转系统「通知使用权」设置页 */
  openNotificationAccessSettings(): void;
  /** 通知累积队列:系统不提供通知历史,只有开启使用权之后到达的通知 */
  getPendingNotifications(options: { clear?: boolean }): Promise<NativeNotificationRecord[]>;
  /** 清空通知队列 */
  clearPendingNotifications(): void;
  /** 按 key 移除队列里的若干条(导入成功后把已入账的通知清掉) */
  removePendingNotifications(keys: string[]): Promise<void>;
}

export default requireOptionalNativeModule<TxnReaderNativeModule>('TxnReader');
