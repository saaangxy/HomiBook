import AsyncStorage from '@react-native-async-storage/async-storage';

// 后台记账需要的「当前账本」跨进程持久化。
//
// 选中账本原本只存在 SecureStore 的 ledgerKey(baseUrl, account) 里,后台 headless
// 拿不到 React 上下文里的 currentLedger,也拼不出那个 key(baseUrl/账号都要先恢复)。
// 这里额外落一份纯 id(不含凭据,普通 AsyncStorage 即可),headless 直接读。
//
// 写入点只有一个:LedgerProvider 的 saveLedgerId(切换/恢复/新建账本时)。

export const AUTO_BOOK_ID_KEY = 'homibook.autoBookBookId';

/** 记录当前账本 id(供后台记账使用);空 id 视为「无账本」直接清掉 */
export async function saveAutoBookBookId(id: string): Promise<void> {
  try {
    if (id) await AsyncStorage.setItem(AUTO_BOOK_ID_KEY, id);
    else await AsyncStorage.removeItem(AUTO_BOOK_ID_KEY);
  } catch {
    // 存储不可用:仅影响后台记账,前台补扫仍然正常
  }
}

/** 读当前账本 id(后台任务用) */
export async function loadAutoBookBookId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(AUTO_BOOK_ID_KEY);
    return id || null;
  } catch {
    return null;
  }
}

/**
 * 最近一次自动记账的执行时刻(前台/后台共写)。
 *
 * 前台自己用内存 ref 做 5 分钟节流,但后台是全新的 JS 上下文,读不到那个 ref ——
 * 两边必须共享一份持久化时间戳,否则「前台刚扫过、后台又扫一遍」会重复打服务器
 * (虽然有「已处理」标记去重,但并发时两边可能都读到未处理状态)。
 */
export const AUTO_BOOK_LAST_RUN_KEY = 'homibook.autoBookLastRun';

/** 记录一次执行(前台 hook 与后台任务都调用) */
export async function markAutoBookRan(at: number = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTO_BOOK_LAST_RUN_KEY, String(at));
  } catch {
    // 存储不可用:退化为各跑各的,「已处理」标记仍能挡住重复入账
  }
}

/** 读最近一次执行时刻(ms),从未执行过返回 0 */
export async function loadAutoBookLastRun(): Promise<number> {
  try {
    return Number((await AsyncStorage.getItem(AUTO_BOOK_LAST_RUN_KEY)) || 0) || 0;
  } catch {
    return 0;
  }
}

// ── 执行锁 ──
// 前台 hook 与后台 headless 会同时处理同一批通知:
// 通知恰好在「前台正在扫」时到达,两边都会读「未处理」集合并提交同一笔,
// 虽然服务端弱校验会拦下第二条,但会多出一条「疑似重复」候选。
// 两边共用这把锁后,后到的那个要么等前一轮结束(后台),要么直接让位(前台)。

const LOCK_KEY = 'homibook.autoBookLock';
/** 锁的过期时间:持有者被系统杀死时锁会残留,超时即视为失效 */
const LOCK_TTL_MS = 60_000;
/** 同一 JS 上下文内的快速互斥(AsyncStorage 没有 CAS,读写之间可能被插队) */
let lockHeld = false;

/** 尝试拿锁;false 表示另一轮(前台或后台)正在执行 */
export async function acquireAutoBookLock(): Promise<boolean> {
  if (lockHeld) return false;
  try {
    const raw = await AsyncStorage.getItem(LOCK_KEY);
    const at = Number(raw || 0);
    if (at && Date.now() - at < LOCK_TTL_MS) return false;
    await AsyncStorage.setItem(LOCK_KEY, String(Date.now()));
    lockHeld = true;
    return true;
  } catch {
    // 存储不可用:退化为「各跑各的」,「已处理」标记仍能挡住重复入账
    lockHeld = true;
    return true;
  }
}

/** 释放锁(必须在 finally 里调用) */
export async function releaseAutoBookLock(): Promise<void> {
  lockHeld = false;
  await AsyncStorage.removeItem(LOCK_KEY).catch(() => {});
}
