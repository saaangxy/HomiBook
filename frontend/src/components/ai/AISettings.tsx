import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  Globe,
  Check,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Plus,
  Copy,
  Pencil,
  Circle,
  Hash,
} from 'lucide-react'
import {
  fetchAIConfig, updateAIConfig, fetchProviders, fetchProviderModels,
  fetchProviderConfigs, createProviderConfig, updateProviderConfig, deleteProviderConfig, copyProviderConfig,
  testProviderConnection,
  type ProviderInfo, type UserProviderConfig,
} from '@/api/chat'

const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
]

export function AIAssistantSettings() {
  // ---------- 通用状态 ----------
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // ---------- 助手配置 ----------
  const [enabled, setEnabled] = useState(false)
  const [simpleConfigId, setSimpleConfigId] = useState<string | null>(null)
  const [simpleModel, setSimpleModel] = useState('')
  const [complexConfigId, setComplexConfigId] = useState<string | null>(null)
  const [complexModel, setComplexModel] = useState('')
  const [language, setLanguage] = useState('zh-CN')
  const [autoConfirm, setAutoConfirm] = useState(false)
  const [maxSteps, setMaxSteps] = useState(10)
  const [visionConfigId, setVisionConfigId] = useState<string | null>(null)
  const [visionModel, setVisionModel] = useState('')

  // ---------- 模型配置列表 ----------
  const [configs, setConfigs] = useState<UserProviderConfig[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  // ---------- 弹窗 ----------
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<UserProviderConfig | null>(null)
  const [formProvider, setFormProvider] = useState('deepseek')
  const [formName, setFormName] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formBaseURL, setFormBaseURL] = useState('')
  const [formTemperature, setFormTemperature] = useState('')
  const [formMaxTokens, setFormMaxTokens] = useState('')
  const [formModels, setFormModels] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [showKey, setShowKey] = useState(false)

  // ---------- 弹窗：测试连接 ----------
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // ---------- 弹窗：模型获取 ----------
  const [formModelList, setFormModelList] = useState<string[]>([])
  const [formFetchingModels, setFormFetchingModels] = useState(false)
  const [formModelSuggestOpen, setFormModelSuggestOpen] = useState(false)
  const formModelSuggestRef = useRef<HTMLDivElement>(null)

  // ==================== 加载 ====================
  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [prefs, providerList, configList] = await Promise.all([
        fetchAIConfig(),
        fetchProviders(),
        fetchProviderConfigs(),
      ])
      setSimpleConfigId(prefs.simpleProviderConfigId)
      setSimpleModel(prefs.simpleModel)
      setComplexConfigId(prefs.complexProviderConfigId)
      setComplexModel(prefs.complexModel)
      setLanguage(prefs.language)
      setAutoConfirm(prefs.autoConfirmCreate)
      setMaxSteps(prefs.maxSteps ?? 10)
      setVisionConfigId(prefs.visionProviderConfigId)
      setVisionModel(prefs.visionModel)
      setEnabled(prefs.enabled)
      setProviders(providerList)
      setConfigs(configList)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  // ==================== 助手配置保存 ====================
  const handleSaveAIConfig = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updateAIConfig({
        enabled,
        simpleProviderConfigId: simpleConfigId,
        simpleModel,
        complexProviderConfigId: complexConfigId,
        complexModel,
        language,
        autoConfirmCreate: autoConfirm,
        maxSteps,
        visionProviderConfigId: visionConfigId,
        visionModel,
      })
      setSuccess('助手配置已保存')
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ==================== 模型配置 CRUD ====================
  const openAddDialog = () => {
    setEditingConfig(null)
    setFormProvider('deepseek')
    setFormName('')
    setFormApiKey('')
    setFormBaseURL('')
    setFormTemperature('')
    setFormMaxTokens('')
    setFormModels('')
    setFormModelList([])
    setFormError('')
    setShowKey(false)
    setTestResult(null)
    setDialogOpen(true)
  }

  const openEditDialog = (config: UserProviderConfig) => {
    setEditingConfig(config)
    setFormProvider(config.provider)
    setFormName(config.name)
    setFormApiKey(config.apiKey === '****' ? '' : config.apiKey)
    setFormBaseURL(config.baseURL)
    setFormTemperature(config.temperature != null ? String(config.temperature) : '')
    setFormMaxTokens(config.maxTokens != null ? String(config.maxTokens) : '')
    setFormModels(config.models)
    setFormModelList([])
    setFormError('')
    setShowKey(false)
    setTestResult(null)
    setDialogOpen(true)
  }

  const handleDeleteConfig = async (id: string) => {
    try {
      await deleteProviderConfig(id)
      setConfigs((prev) => prev.filter((c) => c.id !== id))
      if (simpleConfigId === id) setSimpleConfigId(null)
      if (complexConfigId === id) setComplexConfigId(null)
      setSuccess('模型配置已删除')
    } catch (err: any) {
      setError(err.message || '删除失败')
    }
  }

  const handleCopyConfig = async (id: string) => {
    try {
      const newConfig = await copyProviderConfig(id)
      setConfigs((prev) => [...prev, newConfig])
      setSuccess('模型配置已复制')
    } catch (err: any) {
      setError(err.message || '复制失败')
    }
  }

  const handleSaveConfig = async () => {
    setFormSaving(true)
    setFormError('')
    try {
      const data = {
        provider: formProvider,
        name: formName || undefined,
        apiKey: formApiKey,
        baseURL: formBaseURL,
        temperature: formTemperature ? Number(formTemperature) : null,
        maxTokens: formMaxTokens ? Number(formMaxTokens) : null,
        models: formModels,
      }
      if (editingConfig) {
        const updated = await updateProviderConfig(editingConfig.id, data)
        setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      } else {
        const created = await createProviderConfig(data)
        setConfigs((prev) => [...prev, created])
      }
      setDialogOpen(false)
      setSuccess(editingConfig ? '模型配置已更新' : '模型配置已创建')
    } catch (err: any) {
      setFormError(err.message || '保存失败')
    } finally {
      setFormSaving(false)
    }
  }

  // ==================== 模型辅助 ====================
  const getDefaultModels = useCallback(
    (provider: string) => {
      return providers.find((p) => p.value === provider)?.defaultModels || []
    },
    [providers],
  )

  // 从配置中获取第一个模型名
  const getFirstModel = useCallback(
    (configId: string | null): string => {
      if (!configId) return ''
      const config = configs.find((c) => c.id === configId)
      if (!config) return ''
      if (config.models) {
        const list = config.models.split(',').map((m) => m.trim()).filter(Boolean)
        if (list.length > 0) return list[0]
      }
      return getDefaultModels(config.provider)[0] || ''
    },
    [configs, getDefaultModels],
  )

  // 弹窗中获取模型列表
  const handleFormFetchModels = async () => {
    setFormFetchingModels(true)
    try {
      const res = await fetchProviderModels(formProvider, formBaseURL || undefined)
      setFormModelList(res.models)
    } catch {
      setFormModelList(getDefaultModels(formProvider))
    } finally {
      setFormFetchingModels(false)
    }
  }

  // 测试连接
  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testProviderConnection({
        provider: formProvider,
        apiKey: formApiKey,
        baseURL: formBaseURL || getProviderDefaultBaseURL(formProvider),
        model: formModels || undefined,
        configId: editingConfig?.id,
      })
      setTestResult(res)
      if (res.success && res.models?.length) {
        setFormModelList(res.models)
        setFormModelSuggestOpen(true)
        if (!formModels) {
          setFormModels(res.models[0])
        }
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '测试请求失败' })
    } finally {
      setTesting(false)
    }
  }

  // ==================== 辅助 ====================
  const getProviderLabel = (providerValue: string) => {
    return providers.find((p) => p.value === providerValue)?.label || providerValue
  }

  const getProviderDefaultBaseURL = (providerValue: string) => {
    return providers.find((p) => p.value === providerValue)?.defaultBaseURL || ''
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <Check size={16} />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* ==================== 启用开关 ==================== */}
      <div className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg">
        <div className="flex-1">
          <Label className="text-xs font-medium">启用 AI 助手</Label>
          <p className="text-xs text-muted-foreground mt-0.5">开启后首页显示聊天窗口，关闭则隐藏</p>
        </div>
        <Select value={enabled ? 'true' : 'false'} onValueChange={(v) => setEnabled(v === 'true')}>
          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="false">关闭</SelectItem>
            <SelectItem value="true">开启</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ==================== 模型供应商配置 ==================== */}
      <div>
        <div className="grid grid-cols-2 gap-4">
          {/* 简单任务模型 */}
          <div className="space-y-2">
            <Label className="text-xs">简单任务模型</Label>
            <Select
              value={simpleConfigId || '__none__'}
              onValueChange={(v) => {
                const id = v === '__none__' ? null : v
                setSimpleConfigId(id)
                setSimpleModel(getFirstModel(id))
              }}
            >
              <SelectTrigger><SelectValue placeholder="选择模型配置" /></SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || getProviderLabel(c.provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {simpleConfigId && (
              <div className="text-xs text-muted-foreground px-1">
                模型: {simpleModel}
              </div>
            )}
          </div>

          {/* 复杂任务模型 */}
          <div className="space-y-2">
            <Label className="text-xs">复杂任务模型</Label>
            <Select
              value={complexConfigId || '__none__'}
              onValueChange={(v) => {
                const id = v === '__none__' ? null : v
                setComplexConfigId(id)
                setComplexModel(getFirstModel(id))
              }}
            >
              <SelectTrigger><SelectValue placeholder="选择模型配置" /></SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || getProviderLabel(c.provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {complexConfigId && (
              <div className="text-xs text-muted-foreground px-1">
                模型: {complexModel}
              </div>
            )}
          </div>

          {/* 视觉模型 */}
          <div className="space-y-2">
            <Label className="text-xs">视觉模型（OCR 小票识别）</Label>
            <Select
              value={visionConfigId || '__none__'}
              onValueChange={(v) => {
                const id = v === '__none__' ? null : v
                setVisionConfigId(id)
                setVisionModel(getFirstModel(id))
              }}
            >
              <SelectTrigger><SelectValue placeholder="选择视觉模型配置（可选）" /></SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || getProviderLabel(c.provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {visionConfigId && (
              <div className="text-xs text-muted-foreground px-1">
                模型: {visionModel}
              </div>
            )}
            <p className="text-xs text-muted-foreground">用于识别小票/收据图片，未配置时回退到简单任务模型</p>
          </div>
        </div>
      </div>

      {/* ==================== 对话设置 ==================== */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Globe size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold">对话设置</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">回复语言</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">自动确认记账</Label>
            <Select value={autoConfirm ? 'true' : 'false'} onValueChange={(v) => setAutoConfirm(v === 'true')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="false">关闭（推荐）</SelectItem>
                <SelectItem value="true">开启</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">最大迭代次数</Label>
            <Input
              type="number"
              value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              min={1}
              max={100}
              className="text-xs"
            />
            <p className="text-xs text-muted-foreground">模型调用工具的最大轮次，默认 10</p>
          </div>
        </div>
      </div>

      {/* 保存助手配置 */}
      <Button onClick={handleSaveAIConfig} disabled={saving} className="w-full">
        {saving ? <Spinner /> : '保存配置'}
      </Button>

      {/* ==================== 模型配置列表 ==================== */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Hash size={16} className="text-muted-foreground" />
            <span className="text-sm font-semibold">模型配置列表</span>
          </div>
          <Button variant="outline" size="sm" onClick={openAddDialog}>
            <Plus size={14} className="mr-1" />
            新增
          </Button>
        </div>

        {configs.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">
            暂无模型配置，点击"新增"添加
          </div>
        ) : (
          <div className="space-y-2">
            {Array.isArray(configs) && configs.map((config) => (
              <div key={config.id} className="flex items-center gap-3 p-3 border rounded-lg">
                <Circle
                  size={10}
                  className={config.apiKey ? 'text-green-500 fill-green-500' : 'text-muted-foreground'}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {config.name || getProviderLabel(config.provider)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {getProviderLabel(config.provider)}
                    {config.baseURL && ` · ${config.baseURL}`}
                    {config.apiKey && ' · Key 已配置'}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => openEditDialog(config)}>
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => handleCopyConfig(config.id)}>
                  <Copy size={14} />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => handleDeleteConfig(config.id)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ==================== 弹窗：新增/编辑模型配置 ==================== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingConfig ? '编辑模型配置' : '新增模型配置'}</DialogTitle>
            <DialogDescription>配置 AI 模型供应商的连接信息，包括 API Key、端点地址和模型列表</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 max-h-[60vh] overflow-auto">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            {testResult && (
              <Alert variant={testResult.success ? undefined : 'destructive'}>
                {testResult.success ? <Check size={16} /> : null}
                <AlertDescription>{testResult.message}</AlertDescription>
              </Alert>
            )}
            {/* 供应商类型 */}
            <div className="space-y-1.5">
              <Label className="text-xs">供应商</Label>
              <Select value={formProvider} onValueChange={(v) => {
                setFormProvider(v)
                setFormBaseURL(getProviderDefaultBaseURL(v))
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 名称 */}
            <div className="space-y-1.5">
              <Label className="text-xs">名称（可选）</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如：我的 DeepSeek"
                className="text-xs"
              />
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder={editingConfig?.apiKey ? '留空表示不修改' : '输入 API Key'}
                  className="pr-8 text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-8"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
              </div>
            </div>

            {/* Base URL */}
            <div className="space-y-1.5">
              <Label className="text-xs">API 端点 URL</Label>
              <Input
                value={formBaseURL}
                onChange={(e) => setFormBaseURL(e.target.value)}
                placeholder={getProviderDefaultBaseURL(formProvider) || '输入 API 端点 URL'}
                className="text-xs"
              />
            </div>

            {/* 模型名称 */}
            <div className="space-y-1.5">
              <Label className="text-xs">模型名称</Label>
              <div className="flex gap-1">
                <div ref={formModelSuggestRef} className="relative flex-1">
                  <Input
                    value={formModels}
                    onChange={(e) => setFormModels(e.target.value)}
                    onFocus={() => setFormModelSuggestOpen(true)}
                    onBlur={(e) => {
                      if (formModelSuggestRef.current?.contains(e.relatedTarget as Node)) return
                      setTimeout(() => setFormModelSuggestOpen(false), 150)
                    }}
                    className="text-xs"
                    placeholder={getDefaultModels(formProvider)[0] || '输入模型名称'}
                  />
                  {formModelSuggestOpen && (formModelList.length > 0) && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-auto">
                      {formModelList.map((m) => (
                        <div
                          key={m}
                          className="px-3 py-1.5 text-xs cursor-pointer hover:bg-accent"
                          onMouseDown={(e) => { e.preventDefault(); setFormModels(m); setFormModelSuggestOpen(false) }}
                        >
                          {m}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={formFetchingModels}
                  onClick={handleFormFetchModels}
                  className="shrink-0"
                  title="从接口获取模型列表"
                >
                  {formFetchingModels ? <Spinner /> : <RefreshCw size={14} />}
                </Button>
              </div>
            </div>

            {/* 温度 & MaxTokens */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">温度（可选）</Label>
                <Input
                  type="number"
                  value={formTemperature}
                  onChange={(e) => setFormTemperature(e.target.value)}
                  min={0}
                  max={2}
                  step={0.1}
                  placeholder="0.7"
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">最大 Token（可选）</Label>
                <Input
                  type="number"
                  value={formMaxTokens}
                  onChange={(e) => setFormMaxTokens(e.target.value)}
                  min={1}
                  max={1000000}
                  placeholder="4096"
                  className="text-xs"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
              {testing ? <Spinner /> : '测试连接'}
            </Button>
            <Button onClick={handleSaveConfig} disabled={formSaving || testing}>
              {formSaving ? <Spinner /> : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
