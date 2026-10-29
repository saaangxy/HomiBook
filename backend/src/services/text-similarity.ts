/**
 * 短文本相似度(0~1),用于「备注/交易方」的模糊匹配。
 *
 * 平账、去重共用同一份实现:两边口径必须一致,否则同一对记录在不同弹窗里结论不同。
 *
 * 算法:字符二元组(bigram)的 Dice 系数
 *   sim = 2 × |A∩B| / (|A| + |B|)
 * 中文短文本上比编辑距离更稳(不受语序/长短影响过大),且 O(n)。
 * 比较前统一去掉空白与常见标点,避免「退款-XX」和「退款 XX」被判为不同。
 */

const PUNCT_RE = /[\s\-_/\\|,，。.;；:：!！?？()（）[\]【】{}<>《》"'“”‘’~`@#$%^&*+=]/g

function normalize(s?: string | null): string {
  return (s ?? '').replace(PUNCT_RE, '').toLowerCase()
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i + 2 <= s.length; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** 两段文本的相似度(0~1);任一侧为空返回 0 */
export function textSimilarity(a?: string | null, b?: string | null): number {
  const A = normalize(a)
  const B = normalize(b)
  if (!A || !B) return 0
  if (A === B) return 1
  if (A.length < 2 || B.length < 2) return 0

  const ma = bigrams(A)
  const mb = bigrams(B)
  let overlap = 0
  for (const [g, ca] of ma) {
    const cb = mb.get(g)
    if (cb) overlap += Math.min(ca, cb)
  }
  const total = (A.length - 1) + (B.length - 1)
  return total === 0 ? 0 : Math.round((2 * overlap / total) * 1000) / 1000
}

/** 阈值(0~1)判断;阈值 <= 0 视为不启用 */
export function meetsSimilarity(a: string | undefined | null, b: string | undefined | null, min: number): boolean {
  if (min <= 0) return true
  return textSimilarity(a, b) >= min
}
