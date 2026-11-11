import type { SkillDef } from './types.js'

const PROMPT = `## 图片记账（小票/收据识别）

### 识别与记账
1. 对每个 attachmentId 调 ocr_receipt 识别内容
2. 直接调 create_record / batch_create_records 创建流水(工具内部要用户确认,不必再问)
   - 备注必须**逐字复制**识别结果的 rawText:禁止改写、精简、概括、补充
   - 传 attachmentIds 关联小票
3. 识别有误时按用户指示修正后再记账

### 查找并关联小票
用户要求匹配已有流水时:ocr_receipt 识别 → query_records 搜索 → 展示确认 → update_record 关联附件。

### 注意
- ocr_receipt 给的 accountName/categoryCode 只是初步推断,以实际账户与分类字典为准;分类不存在时选最接近的
- 附件信息里已有「内容摘要/识别文本」说明该图已识别过,直接用,不要重复 ocr_receipt
- 只有追问视觉细节(版面/印章/外观)时才调 view_image
- 多张图逐张识别,最后一次性汇总`

const MULTIMODAL_PROMPT = `## 图片记账（多模态直读）

直读消息中的图片,无需 OCR 工具。

### 记账
1. 读图提取金额、日期、交易方、分类
2. 直接调 create_record / batch_create_records(工具内部要用户确认,不必再问)
   - 备注必须**逐字复制**图上的原文:禁止概括、改写、补充
   - 传 attachmentIds 关联图片
3. 有误时按用户指示修正后再记账

### 查找并关联图片
用户要求匹配已有流水时:读图提取信息 → query_records 搜索 → 展示确认 → update_record 关联。

### 注意
- 图片已在消息里,不要调 ocr_receipt
- 历史轮次图片不在上下文中,凭附件信息里的摘要作答即可,不要因"看不到图"而猜
- 只有追问视觉细节(版面/印章/外观)时才调 view_image
- 备注照抄原文:再长也不要摘要或改写
- 账户和分类需结合系统中的实际账户列表与分类字典来确认和修正
- 如果推断的分类编码在系统中不存在，请选择最接近的分类
- 有多张图片时逐张提取，全部处理完毕后一次性展示汇总结果`

export const imageBillingSkill: SkillDef = {
  name: 'image-billing',
  description: '图片记账：识别小票/收据并记账，或查找对应流水关联小票',
  detect: (message: string) => message.includes('attachmentId:'),
  buildPrompt: (opts) => (opts?.multimodalImage ? MULTIMODAL_PROMPT : PROMPT),
}
