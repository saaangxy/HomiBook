/** 一次对话轮的结果：失败时路由回普通 JSON，成功时 SSE 已经由 emit 写完 */
export type TurnResult =
  | { ok: true; assistantMessageId: string | null; usage: unknown }
  | { ok: false; status: number; message: string }
