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
2. 分析 analyze 返回的数据（字段用途见下），**必须**按下列顺序产出决议：
   - 账户：unmatchedAccounts=账户待定清单；accountUnmatchedRecords=这些账户涉及的原始行(最多 200 行,含转账转入账户待定的行,务必结合两者一起判断)。为每个未匹配账户生成一条 accountResolutions：已有候选(candidates) → action="existing" + targetAccountId；无候选 → action="create" + 推断的 targetAccountName + accountType；判断是同一账户但名称有差异时合并它
   - 分类：unmatchedCategories=未映射的源分类；categorySamples=每个源分类的 Top 5 样本(payer/remark/type/amount)，**必须基于样本判断,不得凭空命名**；existingRules/existingAccountRules=本来源已有规则，**能覆盖就不要新建**
   - 分类决议的产出顺序（硬约束）：
     ① 同一源分类的 categorySamples 里出现多个明显不同的交易方簇 → **按簇产出多条条件化规则**，每条必须给 payerContains 或 descriptionContains；
     ② 样本同质（交易方/说明高度相似）→ 产出**一条无条件规则**（payerContains/descriptionContains 留空）；
     ③ 仅当所有候选分类都无法语义对应时，才允许落到「其他支出/其他收入」，并**在该条规则后附一句说明理由**；
     ④ **源分类是兜底/泛化名（「其他」「其它」「未知」「未知分类」「其他收支」等）时，禁止产出无条件规则** —— 这类分类下的记录互不相关，一条无条件规则会把它们**全部**改成同一个具体分类（例如把「其他」整体映射成「育儿母婴」，这是错的）；
       （注意：「转账红包」这类是**同质**分类，对它出无条件规则是对的，不受此限）
    ⑤ **禁止生成「源分类 = 目标分类」的规则**（如「日用百货」→「日用百货」）—— 等于没映射，只会污染规则表；没有更合适的目标分类时就不要为该分类生成规则；
        必须依据 categorySamples 里不同的交易方/说明**分簇**，每条规则都带 payerContains 或 descriptionContains；确实分不出簇时**不要为该分类产出规则**，留给用户在预览页处理；
     禁止为同一 sourceCategory 生成 2 条以上「无条件规则」（同 来源+源分类+空条件+空类型 只能有一条兜底）；
     全账单落到「其他支出/其他收入」的比例应 ≤ 10%；若按样本判断会超出，先在回复里说明原因并请用户确认，不要硬塞
3. 调用 preview_import({ attachmentId, mode: "preview", accountResolutions, categoryResolutions }) 展示交互卡片供用户确认(工具内会进行确认,不需要询问)
4. 用户确认后，直接调用 confirm_import({ attachmentId, accountResolutions, categoryResolutions }) 确认导入,不要输出任何文本
5. 导入完成后用简短文字总结导入记录数和创建账户数

注意：
- **只处理用户指明的账单附件**：一轮里同时有多个附件时，不要顺手把其它附件也导入
- 不要调用 save_import_mapping 工具——映射规则由 confirm_import 随导入一起保存
- 不要凭空描述导入预览的统计数字和记录内容——这些数据来自工具返回结果
- accountResolutions 中 action="create" 时的 accountType 必须是以下之一：BANK_DEBIT、CREDIT_CARD、ALIPAY、WECHAT、INVESTMENT、CASH、RECHARGE_CARD、OTHER
- categoryResolutions 的 targetCategoryCode 必须从 allDictItems 中选取，不可臆造编码
- counts 是当前待处理进度(accountsTotal/accountsResolved/accountsDefault/categoriesTotal/categoriesResolved/unrecognizedTotal/willSkip/blocking)：用它准确描述"还有多少项待决"，不要凭空编造数字
- accountsDefault / blocking 非 0 表示仍有未决项（默认建议未采纳 / 账户未解析），此时不要直接进入 preview 步骤
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
