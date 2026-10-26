package expo.modules.txnreader

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * 后台记账的入口:银行通知一到达就把 JS 侧拉起来跑一次自动记账。
 *
 * 为什么必须走 Headless JS:解析、账户匹配、两道闸、去重全部在 JS + 服务端,
 * 原生重写一遍会变成两份需要同步维护的实现。
 *
 * 分工:
 * - 本服务只负责「拉起 JS」并带上触发原因;
 * - 是否真的跑由 JS 侧的「自动记账」开关 + 节流决定(见 services/auto-background.ts);
 * - 应用被 ROM 冻结/杀掉时本服务拉不起来,此时仍靠回前台补扫兜底。
 */
class TxnHeadlessTaskService : HeadlessJsTaskService() {

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.createMap().apply {
        putString("reason", intent?.getStringExtra(EXTRA_REASON) ?: REASON_NOTIFICATION)
        putString("source", intent?.getStringExtra(EXTRA_SOURCE).orEmpty())
      },
      TASK_TIMEOUT_MS,
      // App 在前台时通知同样会到达:允许执行,避免 RN 直接丢弃任务;
      // 真正「前台/后台都别重复跑」由 JS 的开关与节流保证
      true
    )

  companion object {
    /** 与 JS 侧 AppRegistry.registerHeadlessTask 的任务名必须一致 */
    const val TASK_KEY = "TxnAutoBookkeeping"

    private const val TAG = "TxnReader"
    private const val EXTRA_REASON = "reason"
    private const val EXTRA_SOURCE = "source"
    private const val REASON_NOTIFICATION = "notification"

    /**
     * JS 侧一轮扫描 + 入账 + 发通知。给 30s:
     * 冷启动 JS(1~2s)+ 本地扫描 + 后端解析 + 提交,20s 在长队列时可能不够,
     * 超时后 RN 只丢弃任务(不会崩),但这一轮就白跑了。
     */
    private const val TASK_TIMEOUT_MS = 30_000L

    /**
     * 「同一条通知」的重复回调合并窗口。
     *
     * 系统对同一条通知的更新会多次回调(同一 key / 同一 postTime);
     * 但**不能**用纯时间窗口合并:两笔真实交易可能相隔不到 1 秒,
     * 那样第二笔就再也进不了 JS。所以只有「postTime 不比上次新」时才合并。
     */
    private const val SAME_NOTIFICATION_WINDOW_MS = 800L

    private var lastScheduleAt = 0L
    private var lastScheduledPostTime = 0L

    /**
     * 请求跑一次后台记账。
     *
     * 通知监听服务由系统绑定,宿主进程优先级较高,通常允许 startService;
     * 但 Android 8+ 的后台启动限制 + 各 ROM 的额外管控仍可能抛异常 ——
     * 这里静默失败即可:回前台补扫始终是兜底路径,不该因为拉不起任务而崩溃。
     *
     * @param postedAt 该通知的 postTime:用来区分「同一条通知重复回调」与「又来了一笔新交易」
     */
    fun schedule(context: Context, source: String?, postedAt: Long) {
      val now = android.os.SystemClock.elapsedRealtime()
      val sameNotification = postedAt <= lastScheduledPostTime
      if (sameNotification && now - lastScheduleAt < SAME_NOTIFICATION_WINDOW_MS) return
      lastScheduleAt = now
      if (postedAt > lastScheduledPostTime) lastScheduledPostTime = postedAt
      try {
        val intent = Intent(context, TxnHeadlessTaskService::class.java).apply {
          putExtra(EXTRA_REASON, REASON_NOTIFICATION)
          putExtra(EXTRA_SOURCE, source.orEmpty())
        }
        context.startService(intent)
      } catch (e: Exception) {
        log(context, "后台记账启动失败:${e.message}")
      }
    }

    /** 调试日志:仅 debuggable 构建输出(adb logcat -s TxnReader) */
    private fun log(context: Context, message: String) {
      val flags = context.applicationInfo?.flags ?: 0
      if (flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
      Log.d(TAG, message)
    }
  }
}
