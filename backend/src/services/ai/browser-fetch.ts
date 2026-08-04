import puppeteer, { type Browser } from 'puppeteer'
import { findSystemChrome } from './browser-config.js'

let browser: Browser | null = null

/** 获取共享浏览器实例（懒加载，复用连接） */
async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser
  const executablePath = findSystemChrome()
  browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', // 隐藏自动化标记
    ],
  })
  return browser
}

/** 进程退出时关闭浏览器 */
process.on('exit', () => { browser?.close().catch(() => {}) })

export interface BrowserFetchResult {
  title: string
  text: string
  url: string
}

/** 注入反检测脚本，在每个页面加载前执行 */
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  window.chrome = { runtime: {} };
`

/**
 * 用无头浏览器渲染页面并提取正文。
 * 能处理 SPA 页面和部分反爬站点。
 */
export async function browserFetch(url: string, timeoutMs = 20000): Promise<BrowserFetchResult> {
  const br = await getBrowser()
  const page = await br.newPage()

  try {
    // 设置真实的 UA 和视口
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    )
    await page.setViewport({ width: 1920, height: 1080 })
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    })

    // 在每个页面导航前注入反检测脚本
    await page.evaluateOnNewDocument(STEALTH_SCRIPT)

    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs })

    // 等待页面渲染（给 SPA 框架时间挂载内容）
    await page.waitForFunction(
      () => { const d = (globalThis as any).document; return d?.body && d.body.innerText.trim().length > 50 },
      { timeout: 8000 },
    ).catch(() => {})

    // 检测是否被反爬拦截（知乎/企查查等站点会显示拦截页面）
    const blocked = await page.evaluate(() => {
      const text = (globalThis as any).document.body?.innerText || ''
      const blockKeywords = [
        '请求存在异常', '暂时限制本次访问',
        '访问被阻断', '安全威胁',
        '验证码', '人机验证', '滑动验证',
        '请完成下方验证后继续操作',
      ]
      // 拦截页面通常很短
      if (text.length < 500) {
        return blockKeywords.some(kw => text.includes(kw))
      }
      return false
    }).catch(() => false)

    if (blocked) {
      throw new Error('网页反爬拦截，无法读取内容')
    }

    // 提取标题和正文
    const result = await page.evaluate(() => {
      const doc = (globalThis as any).document
      const title: string = doc.title || ''

      doc.querySelectorAll('script, style, noscript, nav, header, footer, aside, iframe, svg, form, button, [class*="banner"], [class*="sidebar"], [class*="ad-"], [id*="ad-"]').forEach((el: any) => el.remove())

      const main = doc.querySelector('main, article, [role="main"], #content, .content, .article, .post, #article')
      const bodyEl = (main || doc.body) as any
      const text: string = bodyEl?.innerText || ''

      return { title: title.trim(), text: text.replace(/\s+/g, ' ').trim() }
    })

    return { ...result, url }
  } finally {
    await page.close()
  }
}
