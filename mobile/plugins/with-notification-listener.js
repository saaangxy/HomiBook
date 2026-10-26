// 通知渠道采集端(BankNotificationListener)与后台记账服务(TxnHeadlessTaskService)的 Manifest 注册。
// prebuild 每次重新生成 android/ 后自动应用,替代手工修改 AndroidManifest.xml。
//
// NotificationListenerService 需要三件事:
//   1) android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
//      —— 该权限由**系统**持有,应用侧不需要 <uses-permission>;用户通过「通知使用权」手动授权本应用;
//   2) android:exported="true" —— 系统以绑定方式拉起服务,Android 12+ 未导出则收不到任何回调;
//   3) intent-filter 声明 android.service.notification.NotificationListenerService。
//
// TxnHeadlessTaskService 是普通 service(exported=false):通知到达后由本应用自己 startService 拉起,
// 跑一次 JS 自动记账,不需要也不应该被其它应用调起。
//
// 幂等:重复应用不会重复插入。
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins')

const LISTENER_SERVICE = 'expo.modules.txnreader.BankNotificationListener'
const HEADLESS_SERVICE = 'expo.modules.txnreader.TxnHeadlessTaskService'
const ACTION = 'android.service.notification.NotificationListenerService'
const BIND_PERMISSION = 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE'

// 后台记账需要的权限(WAKE_LOCK / REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
// 统一在 app.json 的 android.permissions 里声明,由 Expo 内置插件写入 manifest ——
// 这里不再手工拼 uses-permission,少一处可能写坏 XML 的地方。

/** 按 android:name 找 service,不存在才插入(保持 prebuild 幂等) */
const ensureService = (app, entry) => {
  const services = Array.isArray(app.service) ? app.service : app.service ? [app.service] : []
  if (!services.some((s) => s && s.$ && s.$['android:name'] === entry.$['android:name'])) {
    services.push(entry)
  }
  app.service = services
}

const withNotificationListener = (config) =>
  withAndroidManifest(config, (cfg) => {
    // modResults 是 { manifest: {...} };必须操作里面那层,
    // 直接把 modResults 当成 manifest 用,写回时根节点会变成 <root>
    // (expo run:android 读 manifest 会直接报 Invalid manifest)
    const modResults = cfg.modResults
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(modResults)

    ensureService(app, {
      $: {
        'android:name': LISTENER_SERVICE,
        'android:exported': 'true',
        'android:permission': BIND_PERMISSION,
        'android:label': '@string/app_name',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': ACTION } }] }],
    })

    ensureService(app, {
      $: {
        'android:name': HEADLESS_SERVICE,
        'android:exported': 'false',
      },
    })

    return cfg
  })

module.exports = withNotificationListener
