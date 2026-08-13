import { useState, useEffect } from 'react'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { DatePicker } from '@/components/ui/date-picker'
import { Search, RotateCcw, Eye, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { adminApi, type AdminUser, type AuditLogItem } from '@/api/admin'

// 操作类型映射：中文 + Badge 颜色
const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  tool_call: { label: '工具调用', className: 'bg-blue-100 text-blue-700' },
  confirm: { label: '用户确认', className: 'bg-green-100 text-green-700' },
  reject: { label: '用户拒绝', className: 'bg-orange-100 text-orange-700' },
  model_call: { label: '模型调用', className: 'bg-purple-100 text-purple-700' },
}

// 状态映射
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  success: { label: '成功', className: 'bg-green-100 text-green-700' },
  error: { label: '失败', className: 'bg-red-100 text-red-700' },
}

// 工具名中文映射（38 个工具，未知工具回退原始名）
const TOOL_NAME_LABELS: Record<string, string> = {
  query_records: '查询流水', query_budgets: '查询预算', query_accounts: '查询账户',
  get_stats: '获取统计', query_categories: '查询分类',
  create_record: '创建流水', update_record: '更新流水', delete_record: '删除流水',
  batch_create_records: '批量创建流水', batch_update_records: '批量更新流水',
  clone_record: '复制流水', detect_duplicates: '检测重复', batch_delete_records: '批量删除流水',
  set_budget: '设置预算', delete_budget: '删除预算', batch_create_budgets: '批量创建预算', copy_budgets: '复制预算',
  query_recurring: '查询固定收支', create_recurring: '创建固定收支', update_recurring: '更新固定收支',
  delete_recurring: '删除固定收支', toggle_recurring: '切换固定收支', loan_preview: '贷款预览', query_repayment_plan: '查询还款计划',
  create_account: '创建账户', update_account: '更新账户', delete_account: '删除账户',
  adjust_balance: '调整余额', query_balance_history: '查询余额历史',
  switch_book: '切换账本', query_members: '查询成员', create_book: '创建账本',
  suggest_options: '建议选项', query_import_mappings: '查询导入映射', save_import_mapping: '保存导入映射',
  preview_import: '预览导入', confirm_import: '确认导入', ocr_receipt: '票据OCR',
  save_memory: '保存记忆', search_memory: '搜索记忆', list_memories: '记忆列表', delete_memory: '删除记忆',
  web_search: '网络搜索', read_webpage: '读取网页',
}

function getToolLabel(name: string | null): string {
  if (!name) return '-'
  return TOOL_NAME_LABELS[name] ?? name
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  if (diffHour < 24) return `${diffHour}小时前`
  if (diffDay < 7) return `${diffDay}天前`
  return date.toLocaleDateString('zh-CN')
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// 键值对表格：解析 JSON 字符串，渲染为 字段|值 两列表格
function KeyValueTable({ jsonStr, title }: { jsonStr: string | null; title: string }) {
  let parsed: unknown = null
  let parseOk = false
  if (jsonStr) {
    try { parsed = JSON.parse(jsonStr); parseOk = true } catch { /* 解析失败降级为原始字符串 */ }
  }
  const isPlainObject = parseOk && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)

  return (
    <div>
      <h4 className="text-sm font-medium mb-2">{title}</h4>
      {!jsonStr ? (
        <p className="text-xs text-muted-foreground">无</p>
      ) : isPlainObject ? (
        <div className="border rounded-md">
          <Table>
            <TableBody>
              {Object.entries(parsed as Record<string, unknown>).map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell className="font-mono text-xs w-1/3 align-top whitespace-nowrap">{k}</TableCell>
                  <TableCell className="text-xs align-top">
                    {v === null || v === undefined ? (
                      <span className="text-muted-foreground">null</span>
                    ) : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? (
                      String(v)
                    ) : (
                      <pre className="text-xs bg-muted p-2 rounded max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(v, null, 2)}</pre>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <pre className="text-xs bg-muted p-2 rounded max-h-60 overflow-auto whitespace-pre-wrap break-all">
          {parseOk ? JSON.stringify(parsed, null, 2) : jsonStr}
        </pre>
      )}
    </div>
  )
}

// Select 内嵌的清除按钮：用 onPointerDown 阻止 Radix Select 打开下拉
function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={-1}
      className="ml-auto h-4 w-4 shrink-0 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      <X size={14} />
    </span>
  )
}

export function AIAuditPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [items, setItems] = useState<AuditLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [jumpInput, setJumpInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 筛选条件
  const [filterUserId, setFilterUserId] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterToolName, setFilterToolName] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterStartTime, setFilterStartTime] = useState('')
  const [filterEndTime, setFilterEndTime] = useState('')

  // 详情弹窗
  const [detailTarget, setDetailTarget] = useState<AuditLogItem | null>(null)

  // 查询审计日志。filterOverrides 用于重置场景（避免 setState 异步导致读到旧值）；pageSizeOverride 用于切换每页条数
  const fetchAuditLogs = async (currentPage: number, filterOverrides?: {
    userId?: string; action?: string; toolName?: string; status?: string; startTime?: string; endTime?: string
  }, pageSizeOverride?: number) => {
    const f = filterOverrides ?? {
      userId: filterUserId, action: filterAction, toolName: filterToolName,
      status: filterStatus, startTime: filterStartTime, endTime: filterEndTime,
    }
    const ps = pageSizeOverride ?? pageSize
    setLoading(true)
    setError('')
    try {
      const result = await adminApi.getAuditLogs({
        page: currentPage, pageSize: ps,
        userId: f.userId || undefined,
        action: f.action || undefined,
        toolName: f.toolName || undefined,
        status: f.status || undefined,
        startTime: f.startTime || undefined,
        // 结束日期追加当日末尾，确保包含所选整天的记录
        endTime: f.endTime ? `${f.endTime}T23:59:59` : undefined,
      })
      setItems(result.items)
      setTotal(result.total)
      setPage(result.page)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    adminApi.listUsers().then(setUsers).catch(() => {})
    fetchAuditLogs(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = () => fetchAuditLogs(1)

  const handleReset = () => {
    setFilterUserId(''); setFilterAction(''); setFilterToolName('')
    setFilterStatus(''); setFilterStartTime(''); setFilterEndTime('')
    fetchAuditLogs(1, {})
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">AI 审计</h1>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 筛选区 */}
      <div className="border rounded-xl p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">用户</span>
            <Select value={filterUserId} onValueChange={setFilterUserId}>
              <SelectTrigger className="w-40 h-9 bg-background border-border">
                <SelectValue placeholder="全部用户" />
                {filterUserId && <ClearButton onClick={() => setFilterUserId('')} />}
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nickname || u.username || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">操作</span>
            <Select value={filterAction} onValueChange={setFilterAction}>
              <SelectTrigger className="w-40 h-9 bg-background border-border">
                <SelectValue placeholder="全部" />
                {filterAction && <ClearButton onClick={() => setFilterAction('')} />}
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {Object.entries(ACTION_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">工具</span>
            <Select value={filterToolName} onValueChange={setFilterToolName}>
              <SelectTrigger className="w-40 h-9 bg-background border-border">
                <SelectValue placeholder="全部" />
                {filterToolName && <ClearButton onClick={() => setFilterToolName('')} />}
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-72">
                {Object.entries(TOOL_NAME_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">状态</span>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40 h-9 bg-background border-border">
                <SelectValue placeholder="全部" />
                {filterStatus && <ClearButton onClick={() => setFilterStatus('')} />}
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">开始</span>
            <DatePicker value={filterStartTime} onChange={setFilterStartTime} placeholder="开始日期" className="w-40" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">结束</span>
            <DatePicker value={filterEndTime} onChange={setFilterEndTime} placeholder="结束日期" className="w-40" />
          </div>
          <Button onClick={handleSearch} size="sm" disabled={loading}>
            <Search size={14} className="mr-1" />
            查询
          </Button>
          <Button onClick={handleReset} size="sm" variant="outline" disabled={loading}>
            <RotateCcw size={14} className="mr-1" />
            重置
          </Button>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <Spinner className="py-12" />
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">暂无审计记录</div>
      ) : (
        <>
          <div className="border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">时间</TableHead>
                  <TableHead className="w-32">用户</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                  <TableHead>工具</TableHead>
                  <TableHead className="w-16">状态</TableHead>
                  <TableHead className="w-16">耗时</TableHead>
                  <TableHead className="w-40">模型</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((log) => {
                  const actionCfg = ACTION_CONFIG[log.action] ?? { label: log.action, className: 'bg-muted text-muted-foreground' }
                  const statusCfg = STATUS_CONFIG[log.status] ?? { label: log.status, className: 'bg-muted text-muted-foreground' }
                  return (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs cursor-default">{formatRelativeTime(log.createdAt)}</span>
                          </TooltipTrigger>
                          <TooltipContent>{formatDateTime(log.createdAt)}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          <div>{log.userNickname || '-'}</div>
                          {log.username && <div className="text-muted-foreground">{log.username}</div>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={actionCfg.className}>{actionCfg.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{getToolLabel(log.toolName)}</TableCell>
                      <TableCell>
                        <Badge className={statusCfg.className}>{statusCfg.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{formatDuration(log.durationMs)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {log.modelProvider || log.modelName
                          ? `${log.modelProvider ?? ''}${log.modelProvider && log.modelName ? ' / ' : ''}${log.modelName ?? ''}`
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setDetailTarget(log)}>
                          <Eye size={14} className="mr-1" />
                          详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* 分页 */}
            <div className="flex items-center justify-between p-4 border-t">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">每页</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { const n = Number(v); setPageSize(n); fetchAuditLogs(1, undefined, n) }}
                >
                  <SelectTrigger className="h-8 w-20 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} 条</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">共 {total} 条</span>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fetchAuditLogs(page - 1)} disabled={page <= 1}>
                  <ChevronLeft size={14} />
                </Button>
                <span className="text-sm min-w-[3.5rem] text-center">
                  {page} / {totalPages}
                </span>
                <Button variant="outline" size="sm" onClick={() => fetchAuditLogs(page + 1)} disabled={page >= totalPages}>
                  <ChevronRight size={14} />
                </Button>
                <span className="text-sm text-muted-foreground ml-2">跳至</span>
                <Input
                  aria-label="跳转页码"
                  className="h-8 w-14 text-sm text-center"
                  placeholder={String(page)}
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = parseInt(jumpInput)
                      if (n >= 1 && n <= totalPages) { fetchAuditLogs(n); setJumpInput('') }
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">页</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 详情弹窗 */}
      <Dialog open={!!detailTarget} onOpenChange={(open) => !open && setDetailTarget(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailTarget && (
                <>
                  <span>{getToolLabel(detailTarget.toolName)}</span>
                  <Badge className={ACTION_CONFIG[detailTarget.action]?.className ?? ''}>
                    {ACTION_CONFIG[detailTarget.action]?.label ?? detailTarget.action}
                  </Badge>
                  <Badge className={STATUS_CONFIG[detailTarget.status]?.className ?? ''}>
                    {STATUS_CONFIG[detailTarget.status]?.label ?? detailTarget.status}
                  </Badge>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailTarget && (
            <div className="space-y-4">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">用户</span>
                  <div>{detailTarget.userNickname || '-'}<span className="text-muted-foreground ml-1 text-xs">{detailTarget.username || ''}</span></div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">时间</span>
                  <div>{formatDateTime(detailTarget.createdAt)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">耗时</span>
                  <div>{formatDuration(detailTarget.durationMs)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">模型</span>
                  <div>{detailTarget.modelProvider || detailTarget.modelName
                    ? `${detailTarget.modelProvider ?? ''}${detailTarget.modelProvider && detailTarget.modelName ? ' / ' : ''}${detailTarget.modelName ?? ''}`
                    : '-'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">IP</span>
                  <div className="font-mono text-xs">{detailTarget.ip || '-'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">会话摘要</span>
                  <div className="text-xs">{detailTarget.sessionSummary || (detailTarget.sessionId ? '（无摘要）' : '-')}</div>
                </div>
              </div>

              {/* 错误信息 */}
              {detailTarget.errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <span className="text-xs text-red-700 font-medium">错误信息</span>
                  <div className="text-xs text-red-600 mt-1">{detailTarget.errorMessage}</div>
                </div>
              )}

              {/* 工具参数 */}
              <KeyValueTable jsonStr={detailTarget.input} title="工具参数" />

              {/* 返回值 */}
              <KeyValueTable jsonStr={detailTarget.output} title="返回值" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
