/**
 * 筛选参数的统一转换:空 → undefined(字段不出现),有值 → 原样数字/字符串。
 *
 * 三端(Web / 移动端)必须走这一套,原因:
 *   Fastify 的 AJV 开了 coerceTypes,body 里显式传 null 会被强转成 0(number)/''(string),
 *   于是「金额留空」到后端变成 amountMax=0(等价于「金额 ≤ 0」)把正数流水全过滤掉。
 *   undefined 在 JSON.stringify 时字段直接消失,后端才会当成「不设条件」。
 */

/** 金额输入框文本 → 数字;空串/非法 → undefined */
export function parseOptionalAmount(text: string | null | undefined): number | undefined {
  const raw = (text ?? '').trim();
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** 文本筛选值(日期、账户、分类等) → 原值;空串/null → undefined */
export function optionalText(value: string | null | undefined): string | undefined {
  const raw = (value ?? '').trim();
  return raw === '' ? undefined : raw;
}

/** 多选筛选值 → 原数组;空数组 → undefined */
export function optionalList<T>(list: T[] | null | undefined): T[] | undefined {
  return list && list.length > 0 ? list : undefined;
}
