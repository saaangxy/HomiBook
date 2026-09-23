import { IMPORT_MESSAGE_PREFIX } from '@homibook/core'
import type { SkillDef } from './types.js'

/**
 * 附件清单里的一行账单表格(`文件名: xxx.csv`)。
 * 与 context-inject 的 buildAttachmentSection 格式成对维护 —— 它决定「用户拖进来的账单文件」也能进入本技能。
 */
const BILL_ATTACHMENT_RE = /文件名:.*\.(csv|xlsx?)\s*$/im

const PROMPT = `## 账单文件与导入流水数据

### 第一步：先判断用户意向（不要擅自导入）
| 用户意图 | 做法 |
| --- | --- |
| 明确要求导入账单 / 入账(如「导入这个账单」「把这些流水录进去」) | 走下面的「导入流程」 |
| 要求作为凭证关联到流水(如「贴到昨天那笔上」「这是那笔的凭证」) | 用 update_record 的 addAttachmentIds、或 create_record / batch_create_records 的 attachmentIds 关联附件，**不要**把它解析成流水 |
| 没说清(只说「处理一下这个文件」「看看这个」) | 先用一句话问清:「按账单导入，还是作为附件关联到某条流水?」——得到答复前不要调用预览/导入工具 |

一个账单文件只做一件事：要么导入，要么关联，不要同时做。用户已明确要求导入时不必再确认，直接进入导入流程。

### 第二步：导入流程（严格按以下顺序调用工具，禁止用文字描述或模拟结果）
1. 调用 preview_import({ attachmentId, mode: "analyze" }) 解析账单**附件**，获取未匹配数据
   - attachmentId 取自本轮**附件清单**里那个账单文件对应的「attachmentId: xxx」，不要填文件名，也不要臆造
   - **不要传 source**：服务端会按文件内容自动识别来源（支付宝/微信/京东）；只有自动识别失败时，才按用户说法显式指定
2. 分析预览结果中的 unmatchedAccounts、unmatchedCategories 和 allDictItems：
   - 为每个未匹配账户生成 accountResolutions：已有候选(candidates) → action="existing" + targetAccountId；无候选 → action="create" + 推断的 targetAccountName + accountType, 判断是同一账户但是名称有差异时合并它
   - 为每个未匹配分类生成 categoryResolutions：根据源分类名和 allDictItems 中的分类编码/标签进行语义匹配，选择 targetCategoryCode；如有明显交易方特征可加 payerContains/descriptionContains 过滤
3. 调用 preview_import({ attachmentId, mode: "preview", accountResolutions, categoryResolutions }) 展示交互卡片供用户确认(工具内会进行确认,不需要询问)
4. 用户确认后，直接调用 confirm_import({ attachmentId, accountResolutions, categoryResolutions }) 确认导入,不要输出任何文本
5. 导入完成后用简短文字总结导入记录数和创建账户数

注意：
- **只处理用户指明的账单附件**：一轮里同时有多个附件时，不要顺手把其它附件也导入
- 不要调用 save_import_mapping 工具——映射规则由 confirm_import 随导入一起保存
- 不要凭空描述导入预览的统计数字和记录内容——这些数据来自工具返回结果
- accountResolutions 中 action="create" 时的 accountType 必须是以下之一：BANK_DEBIT、CREDIT_CARD、ALIPAY、WECHAT、INVESTMENT、CASH、RECHARGE_CARD、OTHER
- categoryResolutions 的 targetCategoryCode 必须从 allDictItems 中选取，不可臆造编码
- 如果步骤3中反复匹配失败（超过10%的记录仍无法匹配），告知用户具体哪些分类无法匹配并请求用户指导`

export const importTransactionsSkill: SkillDef = {
  name: 'import-transactions',
  description: '账单文件(csv/Excel)的处理与导入流水数据',
  /**
   * 两种情况激活:
   * 1. 导入入口发出的那句请求(见 core buildImportMessage 的 IMPORT_MESSAGE_PREFIX)= 用户明确要求导入;
   * 2. 附件清单里出现 csv/xlsx —— 此时提示词负责「先问清是导入还是关联流水」,不会擅自导入。
   * 注意别把条件放宽成「消息里出现附件」:那会让带图片的消息也进导入流程。
   */
  detect: (message: string) => message.includes(IMPORT_MESSAGE_PREFIX) || BILL_ATTACHMENT_RE.test(message),
  buildPrompt: () => PROMPT,
}
