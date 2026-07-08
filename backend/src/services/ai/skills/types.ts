export interface SkillDef {
  name: string
  description: string
  /** 根据用户消息判断是否激活该技能 */
  detect: (userMessage: string) => boolean
  /** 返回该技能的提示词片段 */
  buildPrompt: () => string
}
