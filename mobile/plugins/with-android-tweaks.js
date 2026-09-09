// Android 原生工程构建配置固化(prebuild 每次重新生成 android/ 后自动应用,替代手工修改):
// 1. Gradle wrapper 发行包走腾讯镜像(国内访问 services.gradle.org 易超时;版本号跟随模板自动映射)
// 2. Maven 依赖仓库走阿里镜像(官方仓库兜底,声明顺序即优先级)
// 3. release APK 按架构拆分 + universal 合并包 + 各架构独立 versionCode
// 幂等:重复应用不会重复插入。
// CI 环境(GitHub Actions)整体跳过:海外 runner 走官方源更快更稳,
// 且 ABI 拆分由 workflow 脚本自行注入(含 x86_64),避免本插件的拆分配置使其跳过注入。
// 只认 GITHUB_ACTIONS(=true):勿用泛化 CI 变量——部分本地工具链 shell 也注入 CI=true 会误跳过;
// 未来若迁移其他 CI 平台,在此补充对应环境变量判定。
const isCI = process.env.GITHUB_ACTIONS === 'true'

const { withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

const ALIYUN_MIRRORS = [
  "    maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }",
  "    maven { url 'https://maven.aliyun.com/repository/google' }",
  "    maven { url 'https://maven.aliyun.com/repository/central' }",
  "    maven { url 'https://maven.aliyun.com/repository/public' }",
].join('\n')

const SPLITS_BLOCK = `    // 按架构拆分 APK:每个架构的包只含对应 ABI 的原生库(Hermes/libc++ 等),体积大幅缩小;
    // universalApk 额外生成一个含全部架构的合并包,一个包适配所有设备。
    // 产物: app-armeabi-v7a-release.apk / app-arm64-v8a-release.apk / app-universal-release.apk
    // (模拟器 x86/x86_64 不单拆,由 universal 包覆盖;需要时可加入下方 include 列表)
    splits {
        abi {
            enable true
            reset()
            include "armeabi-v7a", "arm64-v8a"
            universalApk true
        }
    }
`

const VERSION_CODE_BLOCK = `
// 各架构拆分包使用独立 versionCode(上架渠道要求不同 APK code 唯一):abi 权重 * 1000 + 基础 code;
// universal 包 ABI 为 null 保持原始 versionCode,装机升级时永远高于拆分包,避免降级覆盖。
Map abiVersionCodes = ["armeabi-v7a": 1, "x86": 2, "x86_64": 3, "arm64-v8a": 4]
android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abi = output.getFilter(OutputFile.ABI)
        if (abi != null) {
            output.versionCodeOverride = abiVersionCodes.get(abi) * 1000 + variant.versionCode
        }
    }
}
`

function patchWrapper(androidRoot) {
  const file = path.join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties')
  let content = fs.readFileSync(file, 'utf8')
  // host 替换为腾讯镜像,版本号(如 gradle-9.3.1-bin.zip)跟随模板捕获,升级 Gradle 后无需改本插件
  content = content.replace(
    /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/(gradle-[\w.]+-bin\.zip)/,
    'distributionUrl=https\\://mirrors.cloud.tencent.com/gradle/$1'
  )
  content = content.replace(/networkTimeout=\d+/, 'networkTimeout=60000')
  fs.writeFileSync(file, content)
}

function patchRootGradle(androidRoot) {
  const file = path.join(androidRoot, 'build.gradle')
  let content = fs.readFileSync(file, 'utf8')
  if (content.includes('maven.aliyun.com')) return
  // buildscript 与 allprojects 两处 repositories 同锚点(缩进 2/4 空格),镜像插在 google() 前
  content = content.split('  repositories {\n    google()').join(
    '  repositories {\n' + ALIYUN_MIRRORS + '\n    google()'
  )
  fs.writeFileSync(file, content)
}

function patchAppGradle(androidRoot) {
  const file = path.join(androidRoot, 'app', 'build.gradle')
  let content = fs.readFileSync(file, 'utf8')
  if (!content.includes('import com.android.build.OutputFile')) {
    content = 'import com.android.build.OutputFile\n\n' + content
  }
  if (!content.includes('splits {')) {
    content = content.replace('    packagingOptions {', SPLITS_BLOCK + '    packagingOptions {')
  }
  if (!content.includes('abiVersionCodes')) {
    content = content.trimEnd() + '\n\n' + VERSION_CODE_BLOCK
  }
  fs.writeFileSync(file, content)
}

const withAndroidTweaks = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      if (isCI) return cfg
      const androidRoot = cfg.modRequest.platformProjectRoot
      patchWrapper(androidRoot)
      patchRootGradle(androidRoot)
      patchAppGradle(androidRoot)
      return cfg
    },
  ])

module.exports = withAndroidTweaks
