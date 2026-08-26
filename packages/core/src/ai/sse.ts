/**
 * SSE(Server-Sent Events) 流式解析 —— 纯 TS,三端共享。
 * 解析 fetch ReadableStream 中形如:
 *   event: text-delta
 *   data: {...}
 *   (空行分隔)
 * 的数据块,并把事件名+data 回调给调用方。
 */

export interface SSEFrame {
  event: string;
  data: unknown;
}

export type SSEHandler = (frame: SSEFrame) => void;

/**
 * 解析文本流中的 SSE 帧(逐行)。
 * 不依赖 DOM/Node,可被 RN/Hermes 消费。
 */
export function parseSSEStream(
  text: string,
  onFrame: SSEHandler,
): void {
  // SSE 帧以空行分隔
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      else if (line === '') continue;
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join('\n');
    if (raw === '[DONE]') continue;
    try {
      onFrame({ event, data: JSON.parse(raw) });
    } catch {
      // 非 JSON 数据忽略
    }
  }
}

/** 可读流结构(fetch body),兼容 RN 与 Web */
export interface SseReadableStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  };
}

/**
 * 从 fetch 响应流中持续读取并解析 SSE 事件。
 * @param res        fetch 响应体(需可读流)
 * @param onFrame    每收到一个事件回调
 * @param signal     取消信号
 */
export async function consumeSSEStream(
  res: { body?: SseReadableStream | null },
  onFrame: SSEHandler,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: true });
      // 按空行切出完整帧
      let idx = buffer.indexOf('\n\n');
      while (idx >= 0) {
        const frameText = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        parseSSEStream(frameText, onFrame);
        idx = buffer.indexOf('\n\n');
      }
    }
    // 尾部残留
    if (buffer.trim()) parseSSEStream(buffer, onFrame);
  } finally {
    if (signal?.aborted) return;
  }
}
