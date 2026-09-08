export interface SkillDef {
  name: string
  description: string
  /** 根据用户消息判断是否激活该技能 */
  detect: (userMessage: string) => boolean
  /** 返回该技能的提示词片段 */
  buildPrompt: (opts?: SkillPromptOptions) => string
}

/** 技能提示词构建选项 */
export interface SkillPromptOptions {
  /** 主模型为多模态且图片已直接注入消息：技能需切换到免 OCR 的提示词变体 */
  multimodalImage?: boolean
}
