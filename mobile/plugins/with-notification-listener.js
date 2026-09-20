// 通知渠道采集端(BankNotificationListener)的 Manifest 注册。
// prebuild 每次重新生成 android/ 后自动应用,替代手工修改 AndroidManifest.xml。
//
// NotificationListenerService 需要三件事:
//   1) android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
//      —— 该权限由**系统**持有,应用侧不需要 <uses-permission>;用户通过「通知使用权」手动授权本应用;
//   2) android:exported="true" —— 系统以绑定方式拉起服务,Android 12+ 未导出则收不到任何回调;
//   3) intent-filter 声明 android.service.notification.NotificationListenerService。
//
// 幂等:重复应用不会重复插入。
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins')

const SERVICE_NAME = 'expo.modules.txnreader.BankNotificationListener'
const ACTION = 'android.service.notification.NotificationListenerService'
const BIND_PERMISSION = 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE'

const withNotificationListener = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    // xml2js 解析结果可能是对象(单个 service)或数组(多个),统一成数组再判断
    const services = Array.isArray(app.service) ? app.service : app.service ? [app.service] : []
    if (services.some((s) => s && s.$ && s.$['android:name'] === SERVICE_NAME)) return cfg

    services.push({
      $: {
        'android:name': SERVICE_NAME,
        'android:exported': 'true',
        'android:permission': BIND_PERMISSION,
        'android:label': '@string/app_name',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': ACTION } }] }],
    })
    app.service = services
    return cfg
  })

module.exports = withNotificationListener
