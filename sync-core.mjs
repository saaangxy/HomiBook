/**
 * 把 packages/core 的构建产物同步到 node_modules/@homibook/core。
 *
 * 背景：本机 Windows 策略禁止遍历 junction / symlink（ERROR_UNTRUSTED_MOUNT_POINT），
 * 而 `npm install` 会把 workspace 包 `@homibook/core` 建成链接，导致 tsc / vitest
 * 全部解析失败。开启 .npmrc 的 install-links=true 后 npm 会复制；这个脚本用于
 * 复制方案下「改完 core 后快速同步」，不必重跑整次 install。
 *
 * 用法：
 *   node sync-core.mjs            # 目标必须是普通目录
 *   node sync-core.mjs --force    # 目标是链接时先删链接
 */
import fs from 'node:fs'
import path from 'node:path'

const root = import.meta.dirname
const src = path.join(root, 'packages', 'core')
const dest = path.join(root, 'node_modules', '@homibook', 'core')
const force = process.argv.includes('--force')

if (!fs.existsSync(path.join(src, 'dist', 'index.js'))) {
  console.error('✗ packages/core/dist/index.js 不存在，先运行：npm run build:core')
  process.exit(1)
}

let isLink = false
try {
  isLink = fs.lstatSync(dest).isSymbolicLink()
} catch {
  // dest 不存在，cpSync 会自动创建
}

if (isLink) {
  if (!force) {
    console.error(`✗ ${dest} 是链接（本机不可读），请加 --force 或手动删除后重试`)
    process.exit(1)
  }
  fs.rmdirSync(dest)
  console.log('已移除链接')
}

for (const name of ['dist', 'src']) {
  fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true })
}
fs.copyFileSync(path.join(src, 'package.json'), path.join(dest, 'package.json'))
console.log('✓ 已同步 packages/core -> node_modules/@homibook/core')
