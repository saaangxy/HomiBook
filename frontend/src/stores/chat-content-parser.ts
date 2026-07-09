import type { MessageBlock, ToolCallEntry } from './chat'

// ---- 解析历史消息 ----

interface StoredToolCall extends ToolCallEntry {
  textOffset: number
}

export function parseContentIntoBlocks(raw: string, storedToolCalls?: string): MessageBlock[] {
  let toolCalls: StoredToolCall[] = []
  if (storedToolCalls) {
    try {
      toolCalls = JSON.parse(storedToolCalls)
      toolCalls.sort((a, b) => a.textOffset - b.textOffset)
    } catch { /* JSON 解析失败则忽略 */ }
  }

  const blocks: MessageBlock[] = []
  let idCounter = 0
  let lastOffset = 0

  for (const tc of toolCalls) {
    const segment = raw.slice(lastOffset, tc.textOffset)
    const { blocks: segBlocks, nextId } = parseTextSegment(segment, idCounter)
    idCounter = nextId
    for (const b of segBlocks) blocks.push(b)

    const { textOffset: _, ...entry } = tc
    blocks.push({ id: `hist-${idCounter++}`, type: 'tool-call' as const, ...entry })

    lastOffset = tc.textOffset
  }

  const remaining = raw.slice(lastOffset)
  const { blocks: segBlocks } = parseTextSegment(remaining, idCounter)
  for (const b of segBlocks) blocks.push(b)

  return blocks
}

function parseTextSegment(
  text: string,
  startId: number,
): { blocks: MessageBlock[]; nextId: number } {
  const blocks: MessageBlock[] = []
  let idCounter = startId
  const regex = /<think>([\s\S]*?)<\/think>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index)
    if (textBefore.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textBefore })
    const thinkContent = match[1].trim()
    if (thinkContent) blocks.push({ id: `hist-${idCounter++}`, type: 'thinking', content: thinkContent })
    lastIndex = match.index + match[0].length
  }

  const textAfter = text.slice(lastIndex)
  if (textAfter.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textAfter })

  return { blocks, nextId: idCounter }
}

// ---- SSE 流解析 ----

type DeltaState = 'text' | 'thinking'

export type { DeltaState }

export function processTextDelta(
  delta: string,
  thinkState: DeltaState,
  blocks: MessageBlock[],
  idCounter: { value: number },
): DeltaState {
  let state = thinkState
  let remaining = delta

  while (remaining.length > 0) {
    if (state === 'thinking') {
      const closeIdx = remaining.indexOf('</think>')

      if (closeIdx === -1) {
        appendTextToBlocks(blocks, 'thinking', remaining, idCounter)
        remaining = ''
      } else {
        if (closeIdx > 0) appendTextToBlocks(blocks, 'thinking', remaining.slice(0, closeIdx), idCounter)
        remaining = remaining.slice(closeIdx + 8)
        state = 'text'
      }
    } else {
      const openIdx = remaining.indexOf('<think>')
      const closeIdx = remaining.indexOf('</think>')

      if (openIdx === -1 && closeIdx === -1) {
        appendTextToBlocks(blocks, 'text', remaining, idCounter)
        remaining = ''
      } else if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
        if (closeIdx > 0) appendTextToBlocks(blocks, 'thinking', remaining.slice(0, closeIdx), idCounter)
        remaining = remaining.slice(closeIdx + 8)
        state = 'text'
      } else {
        if (openIdx > 0) appendTextToBlocks(blocks, 'text', remaining.slice(0, openIdx), idCounter)
        remaining = remaining.slice(openIdx + 7)
        state = 'thinking'
      }
    }
  }
  return state
}

function appendTextToBlocks(
  blocks: MessageBlock[],
  type: 'text' | 'thinking',
  content: string,
  idCounter: { value: number },
) {
  if (!content) return
  const clean = content.replace(/<\/?think>/g, '')
  if (!clean) return
  const last = blocks[blocks.length - 1]
  if (last && last.type === type) {
    blocks[blocks.length - 1] = {
      ...last,
      content: (last as { content: string }).content + clean,
    } as MessageBlock
  } else if (clean.trim()) {
    blocks.push({ id: `block-${++idCounter.value}`, type, content: clean } as MessageBlock)
  }
}
