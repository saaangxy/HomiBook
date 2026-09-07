import { useState, useEffect, useCallback } from 'react'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { apikeyApi, type ApiKeyItem, type ApiKeyCreated } from '@/api/apikey'
import { Key, Copy, EyeOff, Plus, Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'

// API Key 管理（所有用户可见）
export function ApiKeyManagement() {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [apiKeysLoading, setApiKeysLoading] = useState(false)
  const [apiKeysError, setApiKeysError] = useState('')

  const [createApiKeyOpen, setCreateApiKeyOpen] = useState(false)
  const [apiKeyFormName, setApiKeyFormName] = useState('')
  const [apiKeyFormError, setApiKeyFormError] = useState('')
  const [apiKeySubmitting, setApiKeySubmitting] = useState(false)
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)

  const [deleteApiKeyTarget, setDeleteApiKeyTarget] = useState<ApiKeyItem | null>(null)

  // 数据加载
  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true)
    setApiKeysError('')
    try {
      setApiKeys(await apikeyApi.list())
    } catch (e: any) {
      setApiKeysError(e.message)
    } finally {
      setApiKeysLoading(false)
    }
  }, [])

  // 面板展开挂载时加载数据
  useEffect(() => { loadApiKeys() }, [loadApiKeys])

  // 创建 API Key
  const handleCreateApiKey = async () => {
    if (!apiKeyFormName.trim()) { setApiKeyFormError('请输入名称'); return }
    setApiKeySubmitting(true)
    setApiKeyFormError('')
    try {
      const result = await apikeyApi.create({ name: apiKeyFormName.trim() })
      toast.success('API Key 已创建')
      setCreatedKey(result)
      setCreateApiKeyOpen(false)
      resetApiKeyForm()
      loadApiKeys()
    } catch (e: any) {
      setApiKeyFormError(e.message)
    } finally {
      setApiKeySubmitting(false)
    }
  }

  const handleDeleteApiKey = async () => {
    if (!deleteApiKeyTarget) return
    try {
      await apikeyApi.delete(deleteApiKeyTarget.id)
      toast.success('API Key 已删除')
      setDeleteApiKeyTarget(null)
      loadApiKeys()
    } catch (e: any) {
      setApiKeysError(e.message)
    }
  }

  const resetApiKeyForm = () => {
    setApiKeyFormName('')
    setApiKeyFormError('')
    setApiKeySubmitting(false)
  }

  return (
    <>
      <AccordionItem value="apikeys" className="border rounded-xl px-5">
        <AccordionTrigger className="text-base font-semibold hover:no-underline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Key size={16} className="text-primary-foreground" />
            </div>
            API Key 管理
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-5">
          {/* 创建成功后展示密钥 */}
          {createdKey && (
            <div className="mb-4 p-4 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 space-y-3">
              <div className="flex items-center gap-2">
                <EyeOff size={16} className="text-yellow-600" />
                <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">
                  密钥已生成，请立即复制！关闭后将无法再次查看。
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono break-all select-all">
                  {createdKey.key}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey.key)
                    setKeyCopied(true)
                    setTimeout(() => setKeyCopied(false), 2000)
                  }}
                >
                  {keyCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setCreatedKey(null); setKeyCopied(false) }}
              >
                我已复制，关闭提示
              </Button>
            </div>
          )}

          {apiKeysError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{apiKeysError}</AlertDescription>
            </Alert>
          )}

          {/* 操作栏 */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">
              共 {apiKeys.length} 个 API Key
            </span>
            <Button
              size="sm"
              onClick={() => { resetApiKeyForm(); setCreateApiKeyOpen(true); setApiKeysError('') }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs"
            >
              <Plus size={14} /> 创建 API Key
            </Button>
          </div>

          {/* 表格 */}
          {apiKeysLoading ? (
            <Spinner className="py-8" />
          ) : apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2 border rounded-lg border-dashed">
              <Key size={28} className="opacity-25" />
              <p className="text-sm text-muted-foreground">暂无 API Key</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs">名称</TableHead>
                    <TableHead className="text-xs">密钥前缀</TableHead>
                    <TableHead className="text-xs">归属用户</TableHead>
                    <TableHead className="text-xs">创建时间</TableHead>
                    <TableHead className="text-xs">最后使用</TableHead>
                    <TableHead className="text-xs w-16 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id} className="hover:bg-accent/50">
                      <TableCell className="text-sm py-2.5 font-medium">
                        {key.name}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground py-2.5">
                        {key.prefix}...
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {key.userName}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {new Date(key.createdAt).toLocaleDateString('zh-CN')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {key.lastUsedAt
                          ? new Date(key.lastUsedAt).toLocaleString('zh-CN')
                          : '从未使用'}
                      </TableCell>
                      <TableCell className="text-right py-2.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]"
                          onClick={() => setDeleteApiKeyTarget(key)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AccordionContent>
      </AccordionItem>

      {/* 创建 API Key 弹窗 */}
      <Dialog open={createApiKeyOpen} onOpenChange={setCreateApiKeyOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 API Key</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {apiKeyFormError && (
              <Alert variant="destructive">
                <AlertDescription>{apiKeyFormError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">名称</Label>
              <Input
                aria-label="API Key 名称"
                placeholder="例如：数据分析脚本、自动化任务"
                value={apiKeyFormName}
                onChange={(e) => { setApiKeyFormName(e.target.value); setApiKeyFormError('') }}
                className="bg-background border-border"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateApiKeyOpen(false)}>取消</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleCreateApiKey}
              disabled={apiKeySubmitting}
            >
              {apiKeySubmitting ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除 API Key 确认弹窗 */}
      <AlertDialog open={!!deleteApiKeyTarget} onOpenChange={() => setDeleteApiKeyTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 API Key</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <strong className="text-[#ef4444]">{deleteApiKeyTarget?.name}</strong> 吗？
              使用此密钥的客户端将立即失去访问权限，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#ef4444] hover:bg-[#dc2626]"
              onClick={handleDeleteApiKey}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
