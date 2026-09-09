// 业务时区统一日期语义工具。
// 时区 = 运行环境本地时区:容器部署由 TZ 环境变量控制(docker-compose 默认 Asia/Shanghai,可经 .env 覆盖),
// Node 按 TZ 解析本地墙上时间;导入流水按账单时区(+08:00)解析入库。
// 双端展示按用户本地格式化;若后端查询边界/统计分桶按 UTC 切日,本地凌晨的交易会被归错天或漏算,
// 故所有日期边界与分桶统一锚定业务时区当日(勿再用 toISOString().slice 按 UTC 切日)。
const pad2 = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' → 业务时区当日 00:00:00.000 对应的 UTC 时刻(ISO 日期时间无时区后缀按本地解析) */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00`)
}

/** 'YYYY-MM-DD' → 业务时区当日 23:59:59.999 对应的 UTC 时刻 */
export function dayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999`)
}

/** 任意时刻 → 其所在业务时区日的 00:00(UTC 时刻),用于"按日对齐"基准点(如余额调整);setHours 按 DST 正确处理 */
export function dayStartOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 任意时刻 → 业务时区日期键 YYYY-MM-DD(统计分桶/展示,本地日历字段,勿再用 toISOString().slice) */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 任意时刻 → 业务时区月份键 YYYY-MM(统计分桶) */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

/** 日期过滤起始:'YYYY-MM-DD' 锚定业务时区当日起点;带时间/时区的字符串原样解析 */
export function parseDayStart(raw: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dayStart(raw) : new Date(raw)
}

/** 日期过滤截止:'YYYY-MM-DD' 锚定业务时区当日终点(含整天);带时间/时区的字符串原样解析 */
export function parseDayEnd(raw: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dayEnd(raw) : new Date(raw)
}
