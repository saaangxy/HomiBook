package expo.modules.txnreader

import android.app.Notification
import android.content.ComponentName
import android.content.pm.ApplicationInfo
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject

/**
 * 银行 / 支付 App 通知的采集端(依赖用户手动开启「通知使用权」)。
 *
 * 只做「取到原始标题与正文并落本机队列」:
 * - 来源白名单:只认 SOURCES 里的包名,其余应用的通知一律不读不存;
 * - 粗筛:文本需含金额/交易线索才入队(精确预筛仍在 packages/core/sms-parse.ts)。
 * 这两道都为了少写无关内容到本地存储,而不是为了代替业务判定。
 */
class BankNotificationListener : NotificationListenerService() {

  /**
   * 系统绑定本服务时回调:这是「通知使用权确实生效」的唯一硬证据。
   * 没有这行日志 = 系统根本没把服务拉起来(权限没开 / 被 ROM 解绑),而不是「通知被过滤了」。
   */
  override fun onListenerConnected() {
    super.onListenerConnected()
    log("通知监听已连接(系统已绑定本服务)")
  }

  /** 被系统解绑(重启、省电策略、权限被关)后不会自动回来 —— 主动请求重新绑定,否则服务静默失效 */
  override fun onListenerDisconnected() {
    super.onListenerDisconnected()
    log("通知监听已断开,请求重新绑定")
    try {
      requestRebind(ComponentName(this, BankNotificationListener::class.java))
    } catch (e: Exception) {
      log("重新绑定失败:${e.message}")
    }
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn?.notification ?: return
    val context = applicationContext ?: return
    val pkg = sbn.packageName ?: return
    if (pkg == context.packageName) return

    // 来源白名单:不在名单内的应用通知,连标题正文都不读(先判来源,避免无关内容进内存)。
    // 日志只记包名 —— 白名单外的正文一个字节都不进日志,这是这张表承诺的隐私边界
    val source = SOURCES[pkg] ?: run {
      log("跳过·来源不在白名单 pkg=$pkg")
      return
    }
    // 折叠组摘要只保留明细,避免同一笔出现两条
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) {
      log("跳过·折叠组摘要 pkg=$pkg")
      return
    }

    val extras = notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    // BIG_TEXT 通常是完整正文,TEXT 是折叠态;优先取更完整的一段
    val text = listOf(
      extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
      extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
      extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
    ).firstOrNull { !it.isNullOrBlank() }.orEmpty()
    if (title.isBlank() && text.isBlank()) {
      log("跳过·标题与正文均为空 pkg=$pkg")
      return
    }

    // 标题闸门:同一个 App 既发交易通知也发聊天消息(微信/支付宝),只看包名会把聊天内容当成交易
    // (实测:微信聊天「我家娘子:微信收款10元」被判成一笔收款)。官方交易通知的标题固定带机构名,聊天的是联系人名。
    TITLE_HINTS[pkg]?.let { required ->
      if (!title.contains(required)) {
        log("跳过·标题非官方来源 source=$source title=$title")
        return
      }
    }

    // 粗筛:与钱无关的通知不入队(隐私优先,也不给后续解析添噪声)
    if (!MONEY_HINT.containsMatchIn("$title $text")) {
      log("跳过·无金额线索 source=$source title=$title text=${text.take(60)}")
      return
    }

    val entry = JSONObject().apply {
      put("key", sbn.key ?: "$pkg-${sbn.postTime}")
      put("pkg", pkg)
      put("source", source)
      put("title", title)
      put("text", text)
      put("postedAt", sbn.postTime)
    }
    NotificationQueue.append(context, entry)
    log("已入队 source=$source title=$title text=${text.take(60)}")
  }

  /** 调试日志:仅 debuggable 构建输出(adb logcat -s TxnReader);排查完可整块删除 */
  private fun log(message: String) {
    val flags = applicationInfo?.flags ?: 0
    if (flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
    Log.d(TAG, message)
  }

  private companion object {
    const val TAG = "TxnReader"

    /**
     * 标题闸门:包名 → 标题里必须出现的机构名。
     * 微信 / 支付宝一个包既发交易通知也发聊天消息,只用包名会把聊天内容当成交易;
     * 官方交易通知的标题固定是「微信支付」「微信收款助手」「支付宝」这类,聊天的标题是联系人名。
     * 未列出的来源(纯银行 App)不做此限制。
     */
    val TITLE_HINTS: Map<String, String> = mapOf(
      "com.tencent.mm" to "微信",
      "com.eg.android.AlipayGphone" to "支付宝"
    )

    /** 粗筛线索:命中其一才落队列 */
    val MONEY_HINT = Regex("交易|支出|收入|消费|扣款|扣费|入账|到账|转账|转支|转存|付款|收款|退款|还款|代扣|取现|尾号|余额|人民币|元")

    /**
     * 采集白名单:包名 → 展示名(银行/支付渠道)。
     * 新增渠道只改这里;不在名单内的应用通知完全不读(隐私边界写死在这张表上)。
     */
    val SOURCES: Map<String, String> = mapOf(
      "cmb.pb" to "招商银行",
      "com.icbc" to "中国工商银行",
      "com.android.bankabc" to "中国农业银行",
      "com.chinamworld.main" to "中国建设银行",
      "com.chinamworld.bocmbci" to "中国银行",
      "com.bankcomm.Bankcomm" to "交通银行",
      "com.yitong.mbank.psbc" to "中国邮政储蓄银行",
      "cn.com.spdb.mobilebank.per" to "浦发银行",
      "com.ecitic.bank.mobile" to "中信银行",
      "com.cmbc.cc.mbank" to "民生银行",
      "com.cib.cibmb" to "兴业银行",
      "com.pingan.paces.ccms" to "平安银行",
      "com.cebbank.mobile.cemb" to "光大银行",
      "com.cgbchina.xpt" to "广发银行",
      "com.hxb.mobile.client" to "华夏银行",
      "com.eg.android.AlipayGphone" to "支付宝",
      "com.tencent.mm" to "微信支付",
      "com.unionpay" to "云闪付",
      "com.jd.jrapp" to "京东金融",
      "cn.gov.pbc.dcep" to "数字人民币"
    )
  }
}
