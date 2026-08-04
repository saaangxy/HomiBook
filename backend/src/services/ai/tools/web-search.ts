import * as cheerio from 'cheerio'
import { prisma } from '../../../app.js'
import type { ToolDef, ToolContext } from './types.js'
import type { ToolResult } from '../security.js'

export type SearchEngine = 'bing' | 'baidu' | 'google'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

const DEFAULT_ENGINE: SearchEngine = 'bing'

/** 从 SystemConfig 读取用户配置的搜索引擎 */
async function getConfiguredEngine(): Promise<SearchEngine> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'search_engine' } })
  const val = row?.value as SearchEngine | undefined
  return val === 'baidu' || val === 'google' || val === 'bing' ? val : DEFAULT_ENGINE
}

// ---- Bing ----
async function bingSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=${maxResults}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Bing 搜索请求失败: HTTP ${res.status}`)
  const html = await res.text()
  const $ = cheerio.load(html)
  const results: SearchResult[] = []
  $('#b_results > li.b_algo').each((_, el) => {
    if (results.length >= maxResults) return false
    const titleEl = $(el).find('h2 a')
    const title = titleEl.text().trim()
    const link = titleEl.attr('href') || ''
    const snippet = $(el).find('.b_caption p, .b_algoSlug').text().trim()
    if (title && link) results.push({ title, url: link, snippet })
  })
  return results
}

// ---- Baidu ----
async function baiduSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${maxResults}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Baidu 搜索请求失败: HTTP ${res.status}`)
  const html = await res.text()
  const $ = cheerio.load(html)
  const results: SearchResult[] = []
  // 百度搜索结果在 .result 或 .c-container 中
  $('.result, .c-container').each((_, el) => {
    if (results.length >= maxResults) return false
    const titleEl = $(el).find('h3 a')
    const title = titleEl.text().trim()
    const link = titleEl.attr('href') || ''
    const snippet = $(el).find('.c-abstract, [class*="content-right"]').text().trim()
    if (title && link) results.push({ title, url: link, snippet })
  })
  return results
}

// ---- Google ----
async function googleSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=zh-CN`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Google 搜索请求失败: HTTP ${res.status}`)
  const html = await res.text()
  const $ = cheerio.load(html)
  const results: SearchResult[] = []
  // Google 搜索结果在 #search div.g 中
  $('#search div.g').each((_, el) => {
    if (results.length >= maxResults) return false
    const titleEl = $(el).find('h3')
    const title = titleEl.text().trim()
    const link = titleEl.parent('a').attr('href') || ''
    const snippet = $(el).find('[data-sncf], [style*="-webkit-line-clamp"], .VwiC3b').text().trim()
    if (title && link) results.push({ title, url: link, snippet })
  })
  return results
}

const ENGINE_FUNCS: Record<SearchEngine, (query: string, maxResults: number) => Promise<SearchResult[]>> = {
  bing: bingSearch,
  baidu: baiduSearch,
  google: googleSearch,
}

/** 提示词注入防护：清洗搜索结果文本 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|rules?)/gi,
  /忽略(之前|以上|前面|上述)(的)?(指令|提示|规则|指示)/gi,
  /you\s+are\s+now\s+/gi,
  /你(现在|从现在开始)(是|扮演|作为一个)/gi,
  /system\s*:/gi,
  /系统\s*[:：]/gi,
  /<\s*(script|iframe|img|svg|tool_call|invoke|system)\b[^>]*>/gi,
  /<\/\s*(script|iframe|tool_call|invoke|system)\s*>/gi,
]

function sanitizeText(text: string, maxLen = 300): string {
  let cleaned = text
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[已过滤]')
  }
  // 移除控制字符
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  // 限制长度
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen) + '...'
  return cleaned.trim()
}

function sanitizeResults(results: SearchResult[]): SearchResult[] {
  return results.map(r => ({
    title: sanitizeText(r.title, 200),
    url: r.url,
    snippet: sanitizeText(r.snippet, 500),
  }))
}

export const webSearchTool: ToolDef = {
  name: 'web_search',
  displayName: '网络搜索',
  promptHint: '判断分类、商家等信息不足时搜索获取参考',
  description: '网络搜索。当判断分类、商家、产品等信息不足时，可通过搜索引擎获取参考信息。例如：不确定某商家的行业分类、查询某产品的用途等。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      maxResults: { type: 'number', description: '返回结果数量，默认 5，最多 10' },
    },
    required: ['query'],
  },

  async execute(args: any, _ctx: ToolContext): Promise<ToolResult> {
    const { query, maxResults } = args as { query: string; maxResults?: number }
    const limit = Math.min(maxResults || 5, 10)

    try {
      const engine = await getConfiguredEngine()
      const searchFn = ENGINE_FUNCS[engine]
      const results = sanitizeResults(await searchFn(query, limit))
      return {
        success: true,
        retryable: false,
        data: {
          engine,
          query,
          count: results.length,
          results,
        },
      }
    } catch (err: any) {
      return {
        success: false,
        retryable: true,
        error: `搜索失败: ${err.message || '网络错误'}`,
      }
    }
  },
}
