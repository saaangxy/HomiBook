/**
 * view_image:针对图片的「视觉细节问答」。
 *
 * 常规轮次模型只看到附件的**文字化摘要**(见 services/ai/image-context.ts),不重发 base64;
 * 用户追问摘要回答不了的视觉细节(版面排版、位置、印章、商品外观等)时,模型调用本工具 ——
 * 由**视觉模型**看图后把答案以**文字**返回给主模型。
 *
 * ⚠️ 为什么不用「ToolDef.toModelOutput 把图片作为 tool-result 的 content 回给主模型」:
 * openai-compatible 的 tool 消息**不支持图片 content**,base64 会被当作文本塞进 messages ——
 * 实测单次请求炸到 **320 万 token**(远超 1M 上限,上游 400,整轮对话中断)。
 * 视觉问答与供应商能力解耦,也不会撑爆上下文。
 */
import type { ToolDef } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember } from '../security.js'
import { askImage } from '../image-context.js'
import { stripThinkTags } from '../context-compress.js'

export const viewImageTool: ToolDef = {
  name: 'view_image',
  displayName: '查看图片细节',
  promptHint: '需要确认图片的视觉细节(版面/位置/印章/商品外观等)时调用,由视觉模型看图作答',
  description:
    '针对图片的视觉细节提问,由视觉模型读图后回答。' +
    '附件信息里通常已有该图的「内容摘要/识别文本」—— 金额、日期、交易方等文字性问题直接用摘要回答,不要调用本工具;' +
    '仅当用户追问摘要回答不了的视觉细节(版面排版、位置、印章、商品外观等)时才调用,并把要确认的细节写进 question。',
  parameters: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: '附件 ID（从消息中的附件信息获取）' },
      question: {
        type: 'string',
        description: '要确认的视觉细节,例如「这张小票上有盖章吗?盖在什么位置」。' +
          '仅在 needImage=false（由视觉模型代答）时需要；needImage=true 时不需要填写。',
      },
      needImage: {
        type: 'boolean',
        description: '文字答案不够、需要自己直接看图时置 true —— 系统会在同一次回复的下一步把原图注入,此后你可以自己看图作答',
      },
    },
    required: ['attachmentId'],
  } as Record<string, unknown>,
  requireConfirm: false,

  execute: async (args: { attachmentId: string; question?: string; needImage?: boolean }, ctx) => {
    const { userId, accountBookId } = ctx
    await assertIsMember(accountBookId, userId)

    const attachment = await prisma.recordAttachment.findUnique({
      where: { id: args.attachmentId },
      select: { id: true, path: true, originalFilename: true, recordId: true },
    })
    if (!attachment) return { success: false, error: '附件不存在', retryable: false }

    // 与 ocr_receipt 同口径:已关联流水时校验流水属于当前账本
    if (attachment.recordId) {
      const record = await prisma.record.findUnique({
        where: { id: attachment.recordId },
        select: { accountBookId: true },
      })
      if (record?.accountBookId !== accountBookId) {
        return { success: false, error: '无权访问该附件', retryable: false }
      }
    }

    // needImage=true:模型明确要求自己看图 —— 不再让视觉模型代答一遍(同一张图花两次调用),
    // 也不需要在参数里编一个问题:下一步直接把原图注入,由模型自己看
    if (args.needImage) {
      return {
        success: true,
        retryable: false,
        data: {
          attachmentId: attachment.id,
          originalFilename: attachment.originalFilename,
          requestImage: true,
          hint: '原图将在本次回复的下一步注入,届时你自己看图作答;本轮可先简述已从摘要中确认的信息。',
        },
      }
    }

    const question = (args.question || '').trim() || '这张图片里有哪些值得注意的视觉细节?'

    const res = await askImage(attachment, question, userId)
    if ('error' in res) return { success: false, error: res.error, retryable: false }

    return {
      success: true,
      retryable: false,
      data: {
        attachmentId: attachment.id,
        originalFilename: attachment.originalFilename,
        question,
        // 视觉模型常把推理过程写在 think 里并混进答案,主模型收到的是无用英文推理 → 先剥掉
        answer: stripThinkTags(res.answer),
        /**
         * 请求下一轮把该图作为图片重新注入(由 chat.ts 收集并在下次请求时附加一次)。
         * 不能把 base64 放进 tool-result —— openai-compatible 会当文本,单图就能把请求撑到 300 万 token。
         */
        requestImage: !!args.needImage,
      },
    }
  },
}
