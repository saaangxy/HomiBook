/** Puppeteer 配置：使用系统已安装的 Chrome，避免下载独立的 Chromium */
import { existsSync } from 'fs'

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]

/** 查找系统可用的浏览器可执行文件路径 */
export function findSystemChrome(): string | undefined {
  return CHROME_PATHS.find(p => existsSync(p))
}
