// 北京时区(东八区,无夏令时)统一日期语义工具。
// 背景:导入流水按 +08:00 解析入库(北京时间 10:30 → UTC 02:30),
// 双端展示按用户本地(默认东八区)格式化;若后端查询边界/统计分桶按 UTC 切日,
// 北京凌晨 0-8 点的交易会被归错天或漏算,故所有日期边界与分桶统一锚定北京日。
const BEIJING_OFFSET_MS = 8 * 3600_000
const DAY_MS = 86_400_000

/** 'YYYY-MM-DD' → 北京当日 00:00:00.000 对应的 UTC 时刻 */
export function beijingDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`)
}

/** 'YYYY-MM-DD' → 北京当日 23:59:59.999 对应的 UTC 时刻 */
export function beijingDayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999+08:00`)
}

/** 任意时刻 → 其所在北京日的 00:00(UTC 时刻),用于"按日对齐"基准点(如余额调整) */
export function beijingDayStartOf(date: Date): Date {
  return new Date(Math.floor((date.getTime() + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS)
}

/** 任意时刻 → 北京日期键 YYYY-MM-DD(统计分桶/展示,勿再用 toISOString().slice) */
export function toBeijingDateKey(date: Date): string {
  return new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

/** 任意时刻 → 北京月份键 YYYY-MM(统计分桶) */
export function toBeijingMonthKey(date: Date): string {
  return new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 7)
}

/** 日期过滤起始:'YYYY-MM-DD' 锚定北京当日起点;带时间/时区的字符串原样解析 */
export function parseBeijingDay(raw: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? beijingDayStart(raw) : new Date(raw)
}

/** 日期过滤截止:'YYYY-MM-DD' 锚定北京当日终点(含整天);带时间/时区的字符串原样解析 */
export function parseBeijingDayEnd(raw: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? beijingDayEnd(raw) : new Date(raw)
}
