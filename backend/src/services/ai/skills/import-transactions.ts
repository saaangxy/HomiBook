import type { SkillDef } from './types.js'

const PROMPT = `## 导入流水数据（严格按以下顺序调用工具）
当用户发送导入账单消息（包含 fileId 和 source 参数）时，你必须立即按以下顺序调用工具，禁止用文字描述或模拟结果：

1. 调用 preview_import(fileId, source, mode="analyze") 解析文件获取未匹配数据
2. 分析预览结果中的 unmatchedAccounts、unmatchedCategories 和 allDictItems：
   - 为每个未匹配账户生成 accountResolutions：已有候选(candidates) → action="existing" + targetAccountId；无候选 → action="create" + 推断的 targetAccountName + accountType
   - 为每个未匹配分类生成 categoryResolutions：根据源分类名和 allDictItems 中的分类编码/标签进行语义匹配，选择 targetCategoryCode；如有明显交易方特征可加 payerContains/descriptionContains 过滤
3. 调用 preview_import(fileId, source, mode="preview", { accountResolutions, categoryResolutions }) 展示交互卡片供用户确认(工具内会进行确认,不需要询问)
4. 用户确认后，直接调用 confirm_import(fileId, source, { accountResolutions, categoryResolutions }) 确认导入,不要输出任何文本
5. 导入完成后用简短文字总结导入记录数和创建账户数

注意：
- 不要调用 save_import_mapping 工具——映射规则由 confirm_import 随导入一起保存
- 不要凭空描述导入预览的统计数字和记录内容——这些数据来自工具返回结果
- accountResolutions 中 action="create" 时的 accountType 必须是以下之一：BANK_DEBIT、CREDIT_CARD、ALIPAY、WECHAT、INVESTMENT、CASH、RECHARGE_CARD、OTHER
- categoryResolutions 的 targetCategoryCode 必须从 allDictItems 中选取，不可臆造编码
- 如果步骤3中反复匹配失败（超过10%的记录仍无法匹配），告知用户具体哪些分类无法匹配并请求用户指导`

export const importTransactionsSkill: SkillDef = {
  name: 'import-transactions',
  description: '导入账单流水文件（支付宝/微信/京东）',
  detect: (message: string) => message.includes('fileId:') && message.includes('source:'),
  buildPrompt: () => PROMPT,
}
