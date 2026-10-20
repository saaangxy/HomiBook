/**
 * save_image_content:多模态主模型「看过的图」由它自己固化成文字。
 *
 * 为什么需要:以前是另找视觉模型预提取摘要 —— 同一张图被两个模型各看一遍(成本/延迟翻倍)。
 * 多模态主模型本轮本来就看得见图,让它把看到的内容写进工具参数即可,**不产生第二次识图调用**。
 *
 * 写入的是 RecordAttachment.vision*(与 image-context.ts 同一套缓存字段),所以:
 *   - view_image 的「此前已提取的背景」自动可用;
 *   - 装配历史时的 enrichAttachmentSections 会把摘要补回注入段 ⇒ 后续轮次"记得"图片。
 *
 * 注意:本工具不修改任何账务数据,requireConfirm 必须为 false(弹确认卡会打断对话)。
 */
import type { ToolDef } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember } from '../security.js'

/** 图中文字的存储上限:注入段本身还有 600 字截断,这里只防模型输出异常长文本 */
const MAX_TEXT_CHARS = 4000

export const saveImageContentTool: ToolDef = {
  name: 'save_image_content',
  displayName: '记录图片内容',
  promptHint: '首次收到图片时,先把看到的内容记下来再回答用户;每张图各调用一次',
  description:
    '把你在这张图片里看到的内容固化下来(摘要 / 图中文字 / 关键字段)。' +
    '这样后续轮次凭这些文字就能记得图片,不必重发图片。' +
    '不会修改任何账务数据,不需要用户确认。每张图各调用一次。',
  parameters: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: '附件 ID(从消息里的附件信息中获取)' },
      summary: { type: 'string', description: '一句话说明这是什么(如:一张星巴克小票,合计 38.00 元)' },
      text: { type: 'string', description: '图中识别到的全部文字,按阅读顺序保留;没有文字可省略' },
      meta: {
        type: 'object',
        description: '确凿读到的关键字段(金额/日期/交易方/商品等);没有把握就不要填',
        additionalProperties: true,
      },
    },
    required: ['attachmentId', 'summary'],
  } as Record<string, unknown>,
  requireConfirm: false,

  execute: async (
    args: { attachmentId?: string; summary?: string; text?: string; meta?: Record<string, unknown> },
    ctx,
  ) => {
    const { userId, accountBookId } = ctx
    await assertIsMember(accountBookId, userId)

    const attachmentId = (args.attachmentId || '').trim()
    const summary = (args.summary || '').trim()
    if (!attachmentId) return { success: false, error: '缺少 attachmentId', retryable: false }
    if (!summary) return { success: false, error: '缺少 summary', retryable: false }

    const attachment = await prisma.recordAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, recordId: true },
    })
    if (!attachment) return { success: false, error: '附件不存在', retryable: false }

    // 与 view_image / ocr_receipt 同口径:已关联流水时校验流水属于当前账本
    if (attachment.recordId) {
      const record = await prisma.record.findUnique({
        where: { id: attachment.recordId },
        select: { accountBookId: true },
      })
      if (record?.accountBookId !== accountBookId) {
        return { success: false, error: '无权访问该附件', retryable: false }
      }
    }

    const text = (args.text || '').trim().slice(0, MAX_TEXT_CHARS)
    const meta = args.meta && typeof args.meta === 'object' && !Array.isArray(args.meta) ? args.meta : null

    await prisma.recordAttachment.update({
      where: { id: attachment.id },
      data: {
        visionSummary: summary,
        visionText: text || null,
        visionMeta: meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
        visionAt: new Date(),
      },
    })

    return {
      success: true,
      retryable: false,
      data: { attachmentId: attachment.id, saved: true },
    }
  },
}
