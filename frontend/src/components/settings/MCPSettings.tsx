import { errorMessage, buildMcpCliCommand, buildMcpClientConfig, groupMcpTools, MCP_CONFIG_KEYS, MCP_ENDPOINT, resolveMcpUrl, splitMcpTools } from '@homibook/core'
import { useEffect, useState } from 'react'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { mcpApi, type McpInfo, type McpToolInfo } from '@/api/mcp'
import { settingsApi } from '@/api/settings'
import { useAuthStore } from '@/stores/auth'
import { Plug, Copy, Check, ShieldCheck, Wrench } from 'lucide-react'
import { toast } from 'sonner'

/** 工具能力清单 */
function ToolList({ tools, emptyText }: { tools: McpToolInfo[]; emptyText: string }) {
  if (tools.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }

  return (
    <div className="space-y-3">
      {groupMcpTools(tools).map((group) => (
        <div key={group.category}>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">{group.category}</div>
          <div className="flex flex-wrap gap-1.5">
            {group.tools.map((tool) => (
              <span
                key={tool.name}
                title={`${tool.name}：${tool.description}`}
                className="inline-flex items-center rounded-md border bg-muted/40 px-2 py-1 text-xs"
              >
                {tool.displayName}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// MCP 服务设置（所有用户可见；服务端开关仅管理员可改）
export function MCPSettings() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'

  const [info, setInfo] = useState<McpInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    mcpApi.info()
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [])

  const endpoint = resolveMcpUrl(window.location.origin, info?.endpoint ?? MCP_ENDPOINT)
  const configSnippet = buildMcpClientConfig(endpoint)
  const cliCommand = buildMcpCliCommand(endpoint)
  const { read: readTools, write: writeTools } = splitMcpTools(info?.tools ?? [])

  const updateFlag = async (key: 'mcpEnabled' | 'mcpWriteEnabled', value: boolean) => {
    setSaving(true)
    setError('')
    try {
      // 关闭服务时一并收回写权限，避免下次开启时仍保留高危权限
      const revokeWrite = key === MCP_CONFIG_KEYS.enabled && !value && info?.writeEnabled
      await settingsApi.updateConfig(
        revokeWrite
          ? { [MCP_CONFIG_KEYS.enabled]: false, [MCP_CONFIG_KEYS.writeEnabled]: false }
          : { [key]: value },
      )
      setInfo((prev) =>
        prev
          ? {
              ...prev,
              // 配置键与接口返回字段不同名：mcpEnabled → enabled，mcpWriteEnabled → writeEnabled
              ...(key === MCP_CONFIG_KEYS.enabled ? { enabled: value } : { writeEnabled: value }),
              ...(revokeWrite ? { writeEnabled: false } : {}),
            }
          : prev,
      )
      toast.success(
        key === MCP_CONFIG_KEYS.enabled
          ? (value ? 'MCP 服务已开启' : 'MCP 服务已关闭')
          : (value ? '已允许 MCP 写操作' : '已禁止 MCP 写操作'),
      )
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const copySnippet = () => {
    navigator.clipboard.writeText(configSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <AccordionItem value="mcp" className="border rounded-xl px-5">
      <AccordionTrigger className="text-base font-semibold hover:no-underline">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Plug size={16} className="text-primary-foreground" />
          </div>
          MCP 服务
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 pb-5">
        {loading ? (
          <Spinner className="py-8" />
        ) : (
          <div className="space-y-5">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              开启后，可通过 MCP（Model Context Protocol）把 HomiBook 的账本能力接入 Cursor、Claude Code、
              Cherry Studio 等 AI 客户端，让它们直接查询与操作你的账本数据。
            </p>

            {/* 服务开关 */}
            {isAdmin ? (
              <>
                <div className="flex items-start justify-between gap-8">
                  <div className="flex-1">
                    <h4 className="text-sm font-medium">启用 MCP 服务</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      关闭后所有 MCP 请求都会被拒绝，已配置的客户端将无法连接
                    </p>
                  </div>
                  <Switch
                    aria-label="启用 MCP 服务"
                    checked={info?.enabled ?? false}
                    disabled={saving}
                    onCheckedChange={(v) => updateFlag(MCP_CONFIG_KEYS.enabled, v)}
                  />
                </div>

                <div className="border-t" />

                <div className="flex items-start justify-between gap-8">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck size={14} className="text-muted-foreground" />
                      <h4 className="text-sm font-medium">允许写操作</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      开启后 AI 客户端可创建、修改、删除流水与预算等数据；关闭时仅提供查询、统计与记忆读取
                    </p>
                  </div>
                  <Switch
                    aria-label="允许 MCP 写操作"
                    checked={info?.writeEnabled ?? false}
                    disabled={saving || !info?.enabled}
                    onCheckedChange={(v) => updateFlag(MCP_CONFIG_KEYS.writeEnabled, v)}
                  />
                </div>
              </>
            ) : (
              <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                MCP 服务由管理员统一开启。当前状态：
                <span className="font-medium text-foreground">
                  {info?.enabled ? '已启用' : '未启用'}
                  {info?.enabled ? (info.writeEnabled ? '（含写操作）' : '（仅查询）') : ''}
                </span>
              </div>
            )}

            <div className="border-t" />

            {/* 接入地址 */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">接入地址</h4>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono break-all select-all">
                  {endpoint}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(endpoint)
                    toast.success('地址已复制')
                  }}
                >
                  <Copy size={14} />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                使用 Streamable HTTP（无状态）传输，鉴权方式与开放 API 相同：请求头携带
                <code className="mx-1 bg-muted px-1 py-0.5 rounded">Authorization: Bearer homibook_...</code>
              </p>
            </div>

            {/* 配置指引 */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">配置指引</h4>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>在下方「API Key 管理」中创建一个 API Key（密钥仅创建时显示一次）。</li>
                <li>把下面的配置复制到 MCP 客户端，并将 <code className="bg-muted px-1 py-0.5 rounded">&lt;你的 API Key&gt;</code> 替换为实际密钥。</li>
                <li>重启或刷新客户端，确认工具列表中出现 HomiBook 工具。</li>
                <li>如需创建/修改数据，请管理员开启「允许写操作」。</li>
              </ol>

              <div className="relative">
                <pre className="bg-muted/50 border rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre">
{configSnippet}
                </pre>
                <Button
                  size="icon"
                  variant="outline"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={copySnippet}
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                不同客户端的字段略有差异：Cursor 可直接使用 <code className="bg-muted px-1 py-0.5 rounded">url</code> +
                <code className="mx-1 bg-muted px-1 py-0.5 rounded">headers</code>；若客户端要求指定传输类型，请填写
                <code className="mx-1 bg-muted px-1 py-0.5 rounded">streamable-http</code>。Claude Code 也可用命令行添加：
              </p>
              <code className="block bg-muted/50 border rounded-lg p-3 text-xs font-mono break-all select-all">
                {cliCommand}
              </code>
            </div>

            <div className="border-t" />

            {/* 能力清单 */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">可提供的功能</h4>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">只读</Badge>
                  <span className="text-xs text-muted-foreground">查询、统计与记忆读取，始终可用</span>
                </div>
                <ToolList
                  tools={readTools}
                  emptyText="暂无可用工具"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">写操作</Badge>
                  <span className="text-xs text-muted-foreground">
                    {info?.writeEnabled ? '已开启' : '需管理员开启后才对客户端可见'}
                  </span>
                  <Wrench size={13} className="text-muted-foreground" />
                </div>
                <ToolList
                  tools={writeTools}
                  emptyText="暂无写操作工具"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                依赖前端交互的能力（账单导入预览、小票识别、图片查看、切换账本）以及联网搜索不通过 MCP 暴露。
                所有 MCP 调用都会记录到 AI 审计日志。
              </p>
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
