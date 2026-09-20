package expo.modules.txnreader

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 短信 / 银行通知记账的采集层(仅 Android)。
 *
 * 只做「取到原始文本 + 报告权限状态」:短信回溯扫描、通知使用权状态与跳转、通知累积队列读取。
 * - 运行时权限申请放在 JS 侧(React Native PermissionsAndroid),避免自研权限回调;
 * - 通知由 BankNotificationListener(系统按通知使用权拉起)落 NotificationQueue;
 * - 预筛与解析在 packages/core/sms-parse.ts(纯函数);
 * - 账户匹配与入账复用导入管线「解析成结构化数据之后」的阶段。
 *
 * service 的 Manifest 注册见 mobile/plugins/with-notification-listener.js。
 */
class TxnReaderModule : Module() {
  private fun requireContext(): Context =
    appContext.reactContext ?: throw IllegalStateException("React context 不可用")

  private fun hasSmsPermission(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

  private fun isNotificationAccessGranted(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
    return enabled?.split(':')?.any { it.contains(context.packageName) } ?: false
  }

  override fun definition() = ModuleDefinition {
    Name("TxnReader")

    /** 是否已授予 READ_SMS(同步,供 UI 首帧显示权限状态) */
    Function("hasSmsPermission") {
      hasSmsPermission(requireContext())
    }

    /**
     * 回溯扫描收件箱短信(只读 INBOX,避免把已发送短信重复计入)。
     * options: { start?, end?, limit? } —— start/end 为毫秒时间戳,limit 默认 500、上限 2000。
     * 返回 [{ id, address, body, date, type }],按时间倒序。
     */
    AsyncFunction("listSms") { options: Map<String, Any?> ->
      val context = requireContext()
      if (!hasSmsPermission(context)) {
        throw IllegalStateException("未授予短信读取权限")
      }

      val start = (options["start"] as? Number)?.toLong()
      val end = (options["end"] as? Number)?.toLong()
      val limit = ((options["limit"] as? Number)?.toInt() ?: DEFAULT_LIMIT).coerceIn(1, MAX_LIMIT)

      val selectionParts = mutableListOf("${Telephony.Sms.TYPE} = ${Telephony.Sms.MESSAGE_TYPE_INBOX}")
      val selectionArgs = mutableListOf<String>()
      if (start != null) {
        selectionParts += "${Telephony.Sms.DATE} >= ?"
        selectionArgs += start.toString()
      }
      if (end != null) {
        selectionParts += "${Telephony.Sms.DATE} <= ?"
        selectionArgs += end.toString()
      }

      val projection = arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
        Telephony.Sms.TYPE
      )
      val result = mutableListOf<Map<String, Any?>>()
      // 只用最朴素的列比较:实测部分 ROM/Android 16 的 provider 对 selection / sortOrder 里的 SQL 表达式
      // (如 CASE WHEN …)会**静默返回 0 行**,不报错也不抛异常 —— 日期单位容错因此放到 JS 侧做
      context.contentResolver.query(
        Telephony.Sms.CONTENT_URI,
        projection,
        selectionParts.joinToString(" AND "),
        selectionArgs.toTypedArray(),
        "${Telephony.Sms.DATE} DESC LIMIT $limit"
      )?.use { cursor ->
        while (cursor.moveToNext()) {
          val row = mutableMapOf<String, Any?>()
          row["id"] = cursor.getString(0)
          row["address"] = cursor.getString(1)
          row["body"] = cursor.getString(2)
          row["date"] = cursor.getLong(3)
          row["type"] = cursor.getInt(4)
          result += row
        }
      }

      result
    }

    /** 是否已开启通知使用权(用于银行/支付 App 通知渠道) */
    Function("isNotificationAccessGranted") {
      isNotificationAccessGranted(requireContext())
    }

    /**
     * 读取通知渠道累积队列(系统不提供通知历史,只能捕获开启使用权之后到达的通知)。
     * options: { clear? } —— clear=true 时读完清空。
     * 返回 [{ key, pkg, source, title, text, postedAt }],按到达先后升序。
     */
    AsyncFunction("getPendingNotifications") { options: Map<String, Any?> ->
      val context = requireContext()
      val queue = NotificationQueue.load(context)
      val result = mutableListOf<Map<String, Any?>>()
      for (i in 0 until queue.length()) {
        val item = queue.optJSONObject(i) ?: continue
        val row = mutableMapOf<String, Any?>()
        row["key"] = item.optString("key")
        row["pkg"] = item.optString("pkg")
        row["source"] = item.optString("source")
        row["title"] = item.optString("title")
        row["text"] = item.optString("text")
        row["postedAt"] = item.optLong("postedAt")
        result += row
      }
      if (options["clear"] == true) NotificationQueue.clear(context)
      result
    }

    /** 清空通知队列(设置页「清空本机标记」用) */
    Function("clearPendingNotifications") {
      NotificationQueue.clear(requireContext())
    }

    /**
     * 按 key 移除队列里的若干条:导入成功后调用,把已入账那几条通知从队列清掉。
     * keys 用通知 key(即候选的 sourceId)。
     */
    AsyncFunction("removePendingNotifications") { keys: List<String> ->
      NotificationQueue.remove(requireContext(), keys.toSet())
    }

    /** 跳转系统「通知使用权」设置页(用户需在列表里手动勾选本应用) */
    Function("openNotificationAccessSettings") {
      val context = requireContext()
      try {
        context.startActivity(
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
      } catch (e: Exception) {
        // 少数 ROM 无此设置页:退化为应用详情页,至少不让调用方崩
        context.startActivity(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
      }
    }

    /**
     * 跳转「本应用的权限管理」页(短信权限从那里开)。
     *
     * 小米 / 红米(HyperOS)把短信拆成「普通短信」与「通知类短信」两个开关:银行、服务号、动账类短信属于后者,
     * 系统默认拒绝,**且不提供可供第三方应用申请的运行时权限** —— READ_SMS 只覆盖普通短信,
     * 所以应用既申请不到、也检测不到它(checkSelfPermission 照样返回已授权)。
     * 唯一可行路径是把用户送到系统权限页手动允许;MIUI 的权限编辑页能直达本应用的那个开关,
     * 非 MIUI(或该 action 不可用)时退化为标准的应用详情页。
     */
    Function("openSmsPermissionSettings") {
      val context = requireContext()
      val miuiEditor = Intent("miui.intent.action.APP_PERM_EDITOR")
        .putExtra("extra_pkgname", context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(miuiEditor)
      } catch (e: Exception) {
        // 非 MIUI / action 不可用:退化为应用详情页,至少不让调用方崩
        context.startActivity(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
      }
    }
  }

  private companion object {
    const val DEFAULT_LIMIT = 500
    const val MAX_LIMIT = 2000
  }
}
