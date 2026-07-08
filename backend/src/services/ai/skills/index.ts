import type { SkillDef } from './types.js'
import { importTransactionsSkill } from './import-transactions.js'
import { imageBillingSkill } from './image-billing.js'

/** 所有已注册的技能（新增技能在此注册） */
export const ALL_SKILLS: SkillDef[] = [
  importTransactionsSkill,
  imageBillingSkill,
]

/** 根据用户消息检测需要激活的技能 */
export function detectSkills(userMessage: string): SkillDef[] {
  if (!userMessage) return []
  return ALL_SKILLS.filter((skill) => skill.detect(userMessage))
}

/** 将技能列表构建为合并的提示词字符串 */
export function buildSkillsPrompt(skills: SkillDef[]): string {
  if (skills.length === 0) return ''
  return skills.map((s) => s.buildPrompt()).join('\n\n')
}

/** 从 AI SDK CoreMessage 数组中提取最近的用户消息文本，用于技能检测 */
export function extractUserMessageForSkills(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : ''
      if (content) return content
    }
  }
  return ''
}
