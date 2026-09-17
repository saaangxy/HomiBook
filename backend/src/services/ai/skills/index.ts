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


