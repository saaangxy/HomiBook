package expo.modules.txnreader

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 通知渠道的本地累积队列(SharedPreferences + JSON)。
 *
 * 系统不提供通知历史,只能捕获「开启通知使用权之后」到达的通知,因此需要一个本机队列兜底。
 * 只存白名单来源且含金额/交易线索的通知(见 BankNotificationListener) —— 尽量不把无关内容写进本地存储。
 * 上限 MAX_ITEMS,超出丢弃最旧的;同一通知 key 只保留最新一条(系统更新同一条通知时会重复回调)。
 */
internal object NotificationQueue {
  private const val PREF_NAME = "homibook_txn_reader"
  private const val KEY_QUEUE = "pending_notifications"
  private const val MAX_ITEMS = 500

  private fun prefs(context: Context) = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

  fun load(context: Context): JSONArray {
    val raw = prefs(context).getString(KEY_QUEUE, null) ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (e: Exception) {
      // 数据损坏时丢弃整条队列,不影响后续采集
      JSONArray()
    }
  }

  fun append(context: Context, entry: JSONObject) {
    val queue = load(context)
    val next = JSONArray()
    val key = entry.optString("key")
    for (i in 0 until queue.length()) {
      val item = queue.optJSONObject(i) ?: continue
      if (item.optString("key") != key) next.put(item)
    }
    next.put(entry)

    val trimmed = if (next.length() > MAX_ITEMS) {
      val start = next.length() - MAX_ITEMS
      JSONArray().also { out -> for (i in start until next.length()) out.put(next.get(i)) }
    } else {
      next
    }
    prefs(context).edit().putString(KEY_QUEUE, trimmed.toString()).apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().remove(KEY_QUEUE).apply()
  }

  /**
   * 按 key 移除若干条。
   * 导入成功后把对应通知从队列清掉 —— 否则它们会一直躺在队列里,
   * 靠「已处理」标记在扫描阶段跳过,一旦标记被清(清空本机标记/换设备)就又会作为「疑似重复」冒出来。
   */
  fun remove(context: Context, keys: Set<String>) {
    if (keys.isEmpty()) return
    val queue = load(context)
    val next = JSONArray()
    for (i in 0 until queue.length()) {
      val item = queue.optJSONObject(i) ?: continue
      if (!keys.contains(item.optString("key"))) next.put(item)
    }
    prefs(context).edit().putString(KEY_QUEUE, next.toString()).apply()
  }
}
