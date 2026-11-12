import * as cheerio from 'cheerio'
import { ToolError } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { browserFetch } from '../browser-fetch.js'
import { sanitizeExternalText as sanitizeText } from '../sanitize-text.js'

/** 通用浏览器请求头（fetch 回退用） */
function browserHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  }
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** fetch + cheerio 轻量提取（作为 Puppeteer 的回退） */
async function fetchExtract(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: browserHeaders(),
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return null

    const html = await res.text()
    const $ = cheerio.load(html)
    const title = cleanText($('title').first().text() || $('meta[property="og:title"]').attr('content') || '')
    $('script, style, noscript, nav, header, footer, aside, iframe, svg, form, button').remove()
    const mainEl = $('main, article, [role="main"], #content, .content, .article, .post, #article').first()
    const text = cleanText(mainEl.length ? mainEl.text() : $('body').text())

    // 只有提取到足够内容才返回，否则交由 Puppeteer 处理
    if (text.length > 100) return { title, text }
    return null
  } catch {
    return null
  }
}

export const readWebpageTool: ToolDef = {
  name: 'read_webpage',
  displayName: '读取网页',
  promptHint: '读取指定 URL 的网页正文内容，获取详细信息',
  description: '读取指定 URL 的网页内容。支持动态渲染页面（SPA）。当搜索结果的摘要信息不够，需要获取网页详细内容时调用。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要读取的网页 URL' },
      maxChars: { type: 'number', description: '返回的最大字符数，默认 3000' },
    },
    required: ['url'],
  },

  async execute(args: any, _ctx: ToolContext) {
    const { url, maxChars } = args as { url: string; maxChars?: number }
    const limit = Math.min(maxChars || 3000, 5000)

    // 1. 先用 fetch + cheerio 快速尝试（轻量，对静态页面足够）
    const fastResult = await fetchExtract(url)
    if (fastResult && fastResult.text.length > 100) {
      console.log(`[read_webpage] fetch: url="${url}" chars=${fastResult.text.length}`)
      return {
        url,
        title: sanitizeText(fastResult.title, 200),
        content: sanitizeText(fastResult.text, limit),
      }
    }

    // 2. fetch 不够，用 Puppeteer 无头浏览器渲染
    try {
      console.log(`[read_webpage] puppeteer: url="${url}"`)
      const result = await browserFetch(url, 20000)

      if (!result.text || result.text.length < 20) {
        throw new ToolError('未能提取到网页内容（页面可能需要登录或已阻止访问）')
      }

      console.log(`[read_webpage] puppeteer ok: url="${url}" chars=${result.text.length}`)

      return {
        url: result.url,
        title: sanitizeText(result.title, 200),
        content: sanitizeText(result.text, limit),
      }
    } catch (err: any) {
      const msg = err.message || '未知错误'
      if (msg.includes('net::ERR_BLOCKED') || msg.includes('403')) {
        throw new ToolError(`网页拒绝访问，该站点可能有反爬措施`)
      }
      throw new ToolError(`读取网页失败: ${msg}`, true)
    }
  },
}
