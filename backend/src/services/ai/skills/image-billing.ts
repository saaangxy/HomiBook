import type { SkillDef } from './types.js'

const PROMPT = `## 图片记账（小票/收据识别）

当用户发送包含附件（attachmentId）的消息时，遵循以下流程：

### 识别流程
1. 对于每个 attachmentId，调用 ocr_receipt(attachmentId) 工具识别图片内容
2. 直接调用 create_record 或 batch_create_records 创建流水记录,工具内部会提供给用户确认,不要额外询问
   - 将识别结果中的'rawText'字段完整存入备注(remark)字段
   - 传入 attachmentIds 将小票关联到流水
3. 如果识别结果的日期、金额、分类等有误，请按用户指示修改后再记账

### 查找流水并关联小票
如果用户要求查找对应流水并上传图片：
1. 调用 ocr_receipt(attachmentId) 识别小票内容
2. 根据识别到的金额、日期、交易方等信息，调用 query_records 搜索匹配的流水
3. 展示找到的流水记录供用户确认
4. 确认后调用 update_record 将小票附件关联到对应流水

### 注意事项
- ocr_receipt 返回的 accountName 和 categoryCode 是基于图片内容的初步推断，最终由你根据实际账户列表和分类字典来确认和修正
- 如果识别出的分类编码在系统中不存在，请选择最接近的分类
- 有多张图片时逐张识别，全部识别完毕后一次性展示汇总结果
- 不要调用 save_import_mapping 工具`

const MULTIMODAL_PROMPT = `## 图片记账（多模态直读）

当前主模型为多模态模型，用户消息中已直接附带图片内容，无需调用任何 OCR 工具，直接阅读图片即可。

### 记账流程
1. 直接阅读消息中的图片，提取金额、日期、交易方、分类等信息
2. 直接调用 create_record 或 batch_create_records 创建流水记录，工具内部会提供给用户确认，不要额外询问
   - 将图片中识别到的原始文本内容整理后存入备注(remark)字段
   - 传入 attachmentIds 将图片关联到流水
3. 如果日期、金额、分类等有误，请按用户指示修改后再记账

### 查找流水并关联图片
如果用户要求查找对应流水并上传图片：
1. 直接阅读图片提取金额、日期、交易方等信息
2. 调用 query_records 搜索匹配的流水
3. 展示找到的流水记录供用户确认
4. 确认后调用 update_record 将图片附件关联到对应流水

### 注意事项
- 图片已在消息中直接可见，不要调用 ocr_receipt 工具
- 账户和分类需结合系统中的实际账户列表与分类字典来确认和修正
- 如果推断的分类编码在系统中不存在，请选择最接近的分类
- 有多张图片时逐张提取，全部处理完毕后一次性展示汇总结果
- 不要调用 save_import_mapping 工具`

export const imageBillingSkill: SkillDef = {
  name: 'image-billing',
  description: '图片记账：识别小票/收据并记账，或查找对应流水关联小票',
  detect: (message: string) => message.includes('attachmentId:'),
  buildPrompt: (opts) => (opts?.multimodalImage ? MULTIMODAL_PROMPT : PROMPT),
}
