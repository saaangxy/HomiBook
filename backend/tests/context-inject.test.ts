import { describe, expect, it } from 'vitest'
import {
  buildAttachmentSection,
  foldInjections,
  parseInjectedState,
  planInjection,
  summarizeInjection,
  type InjectedState,
} from '../src/services/ai/context-inject.js'
import { detectSkills } from '../src/services/ai/skills/index.js'
import { IMPORT_MESSAGE_PREFIX } from '@homibook/core'

// 上下文注入的核心不变量:没有差异就绝不写消息(前缀逐字节不变 = 前缀缓存命中)
const EMPTY: InjectedState = { date: null, memoryIds: [], skills: [] }
const MEM_A = { id: 'm1', memoryType: 'habit', content: '每月餐饮约2000元' }
const MEM_B = { id: 'm2', memoryType: 'preference', content: '外卖归入餐饮' }
const SKILL = { name: 'import-transactions', prompt: '## 导入流水数据' }

describe('planInjection(上下文注入差量计划)', () => {
  it('首轮:日期/记忆/技能各注入一段,并记录指纹', () => {
    const plan = planInjection(EMPTY, { today: '2026-09-17', memories: [MEM_A], skills: [SKILL] })
    expect(plan?.text).toContain('2026-09-17')
    expect(plan?.text).toContain('每月餐饮约2000元')
    expect(plan?.text).toContain('[习惯]')
    expect(plan?.text).toContain('## 导入流水数据')
    expect(plan?.nextState).toEqual({ date: '2026-09-17', memoryIds: ['m1'], skills: ['import-transactions'] })
  })

  it('无任何差异时返回 null —— 不写消息,历史前缀保持命中', () => {
    const state: InjectedState = { date: '2026-09-17', memoryIds: ['m1'], skills: ['import-transactions'] }
    expect(planInjection(state, { today: '2026-09-17', memories: [MEM_A], skills: [SKILL] })).toBeNull()
  })

  it('跨天只补日期段', () => {
    const state: InjectedState = { date: '2026-09-17', memoryIds: ['m1'], skills: ['import-transactions'] }
    const plan = planInjection(state, { today: '2026-09-18', memories: [MEM_A], skills: [SKILL] })
    expect(plan?.text).toContain('2026-09-18')
    expect(plan?.text).not.toContain('每月餐饮约2000元')
    expect(plan?.nextState.date).toBe('2026-09-18')
  })

  it('记忆只注入差量(已给过的不再重复占用 token)', () => {
    const state: InjectedState = { date: '2026-09-17', memoryIds: ['m1'], skills: [] }
    const plan = planInjection(state, { today: '2026-09-17', memories: [MEM_A, MEM_B], skills: [] })
    expect(plan?.text).toContain('外卖归入餐饮')
    expect(plan?.text).not.toContain('每月餐饮约2000元')
    expect(plan?.nextState.memoryIds).toEqual(['m1', 'm2'])
  })

  it('同名技能只注入一次', () => {
    const state: InjectedState = { date: '2026-09-17', memoryIds: [], skills: ['import-transactions'] }
    expect(planInjection(state, { today: '2026-09-17', memories: [], skills: [SKILL] })).toBeNull()
  })

  it('注入文本带「不要复述」标记,避免模型把它当成用户发言去回应', () => {
    const plan = planInjection(EMPTY, { today: '2026-09-17', memories: [], skills: [] })
    expect(plan?.text.startsWith('[系统追加的上下文')).toBe(true)
  })

  it('临时上下文(附件清单)每轮都注入,且不参与指纹去重', () => {
    const state: InjectedState = { date: '2026-09-17', memoryIds: ['m1'], skills: [] }
    const plan = planInjection(state, {
      today: '2026-09-17',
      memories: [MEM_A],
      skills: [],
      extraSections: ['[附件信息]\nattachmentId: a1'],
    })
    expect(plan?.text).toContain('attachmentId: a1')
    // 指纹保持不变:附件清单是每轮一次的临时上下文,不该被「已注入」记录吞掉
    expect(plan?.nextState).toEqual(state)
  })

  it('临时上下文追加在日期/记忆段之后(离本轮请求最近)', () => {
    const plan = planInjection(EMPTY, {
      today: '2026-09-17',
      memories: [],
      skills: [],
      extraSections: ['[附件信息]'],
    })
    expect(plan!.text.indexOf('2026-09-17')).toBeLessThan(plan!.text.indexOf('[附件信息]'))
  })

  it('无状态差异且无有效临时上下文时仍不写消息', () => {
    const state: InjectedState = { date: '2026-09-17', memoryIds: [], skills: [] }
    expect(planInjection(state, { today: '2026-09-17', memories: [], skills: [], extraSections: [] })).toBeNull()
    expect(planInjection(state, { today: '2026-09-17', memories: [], skills: [], extraSections: ['', ''] })).toBeNull()
  })

  it('parseInjectedState:坏数据/缺字段一律按「未注入」处理', () => {
    expect(parseInjectedState(null)).toEqual(EMPTY)
    expect(parseInjectedState('{oops')).toEqual(EMPTY)
    expect(parseInjectedState('{"date":123,"memoryIds":"x"}')).toEqual(EMPTY)
  })
})

describe('summarizeInjection(写入与解析成对维护)', () => {
  it('能反解 planInjection 生成的注入文本', () => {
    const plan = planInjection(EMPTY, { today: '2026-09-17', memories: [MEM_A, MEM_B], skills: [SKILL] })
    expect(plan).not.toBeNull()
    const summary = summarizeInjection(plan!.text)
    expect(summary.date).toBe('2026-09-17')
    expect(summary.memories).toEqual(['[习惯] 每月餐饮约2000元', '[偏好] 外卖归入餐饮'])
    expect(summary.skills).toEqual(['导入流水数据'])
    expect(summary.hasAttachments).toBe(false)
    expect(summary.raw).toBe(plan!.text)
  })

  it('附件清单段能被识别,且与日期共存', () => {
    const section = buildAttachmentSection([{ id: 'a1', originalFilename: 'x.png' }])
    expect(section).toContain('attachmentId: a1')
    expect(buildAttachmentSection([])).toBe('')

    const plan = planInjection(EMPTY, { today: '2026-09-17', memories: [], skills: [], extraSections: [section] })
    const summary = summarizeInjection(plan!.text)
    expect(summary.date).toBe('2026-09-17')
    expect(summary.hasAttachments).toBe(true)
  })

  it('附件段不会冒充「导入请求」标记(detectSkills 入参含本段)', () => {
    const names = (text: string) => detectSkills(text).map((s) => s.name)

    // csv 附件本身激活导入技能 —— 它的提示词负责「先问清是导入还是关联流水」,不会擅自导入
    const csvSection = buildAttachmentSection([{ id: 'a1', originalFilename: '京东交易流水.csv' }])
    expect(names(csvSection)).toContain('import-transactions')
    // 但段内绝不能出现「请导入」这个显式请求标记:否则每条带附件的消息都会被当成用户明确要求导入
    expect(csvSection).not.toContain(IMPORT_MESSAGE_PREFIX)

    // 图片附件不进导入流程(图片记账技能负责它)
    const imgSection = buildAttachmentSection([{ id: 'a2', originalFilename: '小票.png' }])
    expect(names(imgSection)).not.toContain('import-transactions')

    // 用户明说导入(无附件)也要激活
    expect(names(`${IMPORT_MESSAGE_PREFIX}微信账单文件`)).toContain('import-transactions')
  })

  it('只注入记忆(未跨天)时日期为 null,记忆仍可解析', () => {
    const state: InjectedState = { date: '2026-09-17', memoryIds: [], skills: [] }
    const plan = planInjection(state, { today: '2026-09-17', memories: [MEM_A], skills: [] })
    const summary = summarizeInjection(plan!.text)
    expect(summary.date).toBeNull()
    expect(summary.memories).toEqual(['[习惯] 每月餐饮约2000元'])
    expect(summary.skills).toEqual([])
  })
})

describe('foldInjections(注入折叠,两个装配路径共用)', () => {
  it('按 parentMessageId 折叠回所属用户消息,且只影响那一条', () => {
    const messages = [{ role: 'user', content: '记一笔咖啡' }, { role: 'assistant', content: '好的' }]
    foldInjections(messages, ['u1', 'a1'], [{ parentMessageId: 'u1', content: '[系统追加] 今天是 2026-09-17' }])
    expect(messages[0].content).toBe('记一笔咖啡\n\n[系统追加] 今天是 2026-09-17')
    expect(messages[1].content).toBe('好的')
  })

  it('同一消息的多条注入按传入顺序拼接', () => {
    const messages = [{ role: 'user', content: 'Q' }]
    foldInjections(messages, ['u1'], [
      { parentMessageId: 'u1', content: 'A' },
      { parentMessageId: 'u1', content: 'B' },
    ])
    expect(messages[0].content).toBe('Q\n\nA\n\nB')
  })

  it('无注入或未绑定消息时原样返回', () => {
    const messages = [{ role: 'user', content: 'Q' }]
    foldInjections(messages, ['u1'], [])
    foldInjections(messages, ['u1'], [{ parentMessageId: null, content: 'X' }])
    expect(messages[0].content).toBe('Q')
  })

  it('content 非字符串(多模态数组)时跳过,不破坏消息结构', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Q' }] }]
    foldInjections(messages, ['u1'], [{ parentMessageId: 'u1', content: 'X' }])
    expect(Array.isArray(messages[0].content)).toBe(true)
  })
})
