import type { SkillDef } from './types.js'

const PROMPT = `## 图片记账（小票/收据识别）

当用户发送包含附件（attachmentId）的消息时，遵循以下流程：

### 识别流程
1. 对于每个 attachmentId，调用 ocr_receipt(attachmentId) 工具识别图片内容
2. 调用 create_record 或 batch_create_records 创建流水记录,展示给用户确认
   - 将识别数据的rawText字段完整存入备注(remark)字段
   - 传入 attachmentIds 将小票关联到流水
3. 如果识别结果的日期、金额、分类等有误，请按用户指示修改后再记账

### 查找流水并关联小票
如果用户要求查找对应流水并上传小票：
1. 调用 ocr_receipt(attachmentId) 识别小票内容
2. 根据识别到的金额、日期、交易方等信息，调用 query_records 搜索匹配的流水
3. 展示找到的流水记录供用户确认
4. 确认后调用 update_record 将小票附件关联到对应流水

### 注意事项
- ocr_receipt 返回的 accountName 和 categoryCode 是基于图片内容的初步推断，最终由你根据实际账户列表和分类字典来确认和修正
- 如果识别出的分类编码在系统中不存在，请选择最接近的分类
- 有多张图片时逐张识别，全部识别完毕后一次性展示汇总结果
- 不要调用 save_import_mapping 工具`

export const imageBillingSkill: SkillDef = {
  name: 'image-billing',
  description: '图片记账：识别小票/收据并记账，或查找对应流水关联小票',
  detect: (message: string) => message.includes('attachmentId:'),
  buildPrompt: () => PROMPT,
}
