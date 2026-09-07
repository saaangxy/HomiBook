import { useState, useEffect } from 'react'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { settingsApi } from '@/api/settings'
import { holidayApi } from '@/api/holiday'
import { ThemeSelector } from '@/components/ThemeSelector'
import { Check, Settings, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD']

const HOLIDAY_API_OPTIONS = [
  { value: 'https://timor.tech/api/holiday/year/{year}', label: 'timor.tech（免费，推荐）' },
  { value: 'https://api.jiejiariapi.com/v1/holidays/{year}', label: 'jiejiariapi.com（备选）' },
]

const JWT_EXPIRE_OPTIONS = [
  { value: '1d', label: '1 天' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
]

const AUDIT_RETENTION_OPTIONS = [
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '180', label: '180 天' },
]

// 通用设置（仅管理员可见）
export function GeneralSettings() {
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [defaultCurrency, setDefaultCurrency] = useState('CNY')
  const [amountHighlightThreshold, setAmountHighlightThreshold] = useState(1000)
  const [holidayApiUrl, setHolidayApiUrl] = useState('https://timor.tech/api/holiday/year/{year}')
  const [defaultTheme, setDefaultTheme] = useState('system')
  const [jwtExpiresIn, setJwtExpiresIn] = useState('7d')
  const [auditLogRetentionDays, setAuditLogRetentionDays] = useState('7')
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [syncingHolidays, setSyncingHolidays] = useState(false)

  // 加载通用配置
  useEffect(() => {
    setConfigLoading(true)
    settingsApi.getConfig()
      .then((config) => {
        if (typeof config.registrationOpen === 'boolean') setRegistrationOpen(config.registrationOpen)
        if (typeof config.defaultCurrency === 'string') setDefaultCurrency(config.defaultCurrency)
        if (typeof config.amountHighlightThreshold === 'number') setAmountHighlightThreshold(config.amountHighlightThreshold)
        if (typeof config.holidayApiUrl === 'string') setHolidayApiUrl(config.holidayApiUrl)
        if (typeof config.defaultTheme === 'string') setDefaultTheme(config.defaultTheme)
        if (typeof config.jwtExpiresIn === 'string' && JWT_EXPIRE_OPTIONS.some(o => o.value === config.jwtExpiresIn)) setJwtExpiresIn(config.jwtExpiresIn)
        if (typeof config.auditLogRetentionDays === 'string' && AUDIT_RETENTION_OPTIONS.some(o => o.value === config.auditLogRetentionDays)) setAuditLogRetentionDays(config.auditLogRetentionDays)
      })
      .catch(() => setConfigError('加载配置失败'))
      .finally(() => setConfigLoading(false))
  }, [])

  // 同步节假日
  const handleSyncHolidays = async () => {
    setSyncingHolidays(true)
    try {
      const result = await holidayApi.sync()
      toast.success(`同步完成，导入了 ${result.imported} 条节假日数据`)
    } catch (e: any) {
      toast.error(`同步失败：${e.message}`)
    } finally {
      setSyncingHolidays(false)
    }
  }

  // 保存配置
  const handleSaveConfig = async () => {
    setConfigSaving(true)
    setConfigError('')
    try {
      await settingsApi.updateConfig({ registrationOpen, defaultCurrency, amountHighlightThreshold, holidayApiUrl, defaultTheme, jwtExpiresIn, auditLogRetentionDays })
      toast.success('配置已保存')
    } catch (e: any) {
      setConfigError(e.message)
    } finally {
      setConfigSaving(false)
    }
  }

  return (
    <AccordionItem value="general" className="border rounded-xl px-5">
      <AccordionTrigger className="text-base font-semibold hover:no-underline">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Settings size={16} className="text-primary-foreground" />
          </div>
          通用设置
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 pb-5">
        {configLoading ? (
          <Spinner className="py-8" />
        ) : (
          <div className="space-y-5">
            {configError && (
              <Alert variant="destructive">
                <AlertDescription>{configError}</AlertDescription>
              </Alert>
            )}

            {/* 开放注册 */}
            <div className="flex items-start justify-between gap-8">
              <div className="flex-1">
                <h4 className="text-sm font-medium">开放注册</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  关闭后登录页面将隐藏注册入口，仅显示登录表单
                </p>
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setRegistrationOpen(true)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    registrationOpen
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {registrationOpen && <Check size={12} />}
                  已开启
                </button>
                <button
                  type="button"
                  onClick={() => setRegistrationOpen(false)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    !registrationOpen
                      ? 'bg-[#ef4444] text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  已关闭
                </button>
              </div>
            </div>

            {/* 分隔 */}
            <div className="border-t" />

            {/* 默认货币 */}
            <div className="flex items-start justify-between gap-8">
              <div className="flex-1">
                <h4 className="text-sm font-medium">默认货币</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  新建账本时使用的默认货币单位
                </p>
              </div>
              <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
                <SelectTrigger className="w-28 bg-background border-border h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 分隔 */}
            <div className="border-t" />

            {/* 支出高亮阈值 */}
            <div className="flex items-start justify-between gap-8">
              <div className="flex-1">
                <h4 className="text-sm font-medium">支出高亮阈值</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  流水日历中当日支出超过此金额的日期将高亮显示（单位：元）
                </p>
              </div>
              <Input
                aria-label="支出高亮阈值"
                type="number"
                min="0"
                step="100"
                placeholder="1000"
                value={amountHighlightThreshold}
                onChange={(e) => setAmountHighlightThreshold(parseFloat(e.target.value) || 0)}
                className="w-28 bg-background border-border h-9"
              />
            </div>

            {/* 分隔 */}
            <div className="border-t" />

            {/* JWT 过期时间 */}
            <div className="flex items-start justify-between gap-8">
              <div className="flex-1">
                <h4 className="text-sm font-medium">登录有效期</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  登录后 Token 的有效时长，超过后需重新登录。修改仅对后续登录生效
                </p>
              </div>
              <Select value={jwtExpiresIn} onValueChange={setJwtExpiresIn}>
                <SelectTrigger className="w-28 bg-background border-border h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {JWT_EXPIRE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 分隔 */}
            <div className="border-t" />

            {/* AI 审计日志保留 */}
            <div className="flex items-start justify-between gap-8">
              <div className="flex-1">
                <h4 className="text-sm font-medium">AI 审计日志保留</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  超过保留天数的 AI 操作记录将自动删除，查看审计页面时触发清理
                </p>
              </div>
              <Select value={auditLogRetentionDays} onValueChange={setAuditLogRetentionDays}>
                <SelectTrigger className="w-28 bg-background border-border h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {AUDIT_RETENTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 分隔 */}
            <div className="border-t" />

            {/* 节假日 API */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1">
                  <h4 className="text-sm font-medium">节假日数据源</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    选择节假日 API 地址，用于同步和显示节假日/调休信息
                  </p>
                </div>
                <Select value={holidayApiUrl} onValueChange={setHolidayApiUrl}>
                  <SelectTrigger className="w-56 bg-background border-border h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {HOLIDAY_API_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                aria-label="节假日 API 地址"
                placeholder="或输入自定义 API 地址，{year} 为年份占位符"
                value={holidayApiUrl}
                onChange={(e) => setHolidayApiUrl(e.target.value)}
                className="bg-background border-border h-9"
              />
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSyncHolidays}
                  disabled={syncingHolidays}
                >
                  <RefreshCw size={14} className="mr-1" />
                  {syncingHolidays ? '同步中...' : '同步节假日'}
                </Button>
              </div>
            </div>

            {/* 分隔 */}
            <div className="border-t" />

            {/* 默认主题 */}
            <div className="flex items-start justify-between gap-8">
              <div className="flex-1">
                <h4 className="text-sm font-medium">全局默认主题</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  未设置个人主题的用户将使用此主题。选"跟随系统"时根据系统明暗自动切换
                </p>
              </div>
            </div>
            <ThemeSelector showSystem value={defaultTheme} onChange={setDefaultTheme} />

            {/* 分隔 */}
            <div className="border-t" />

            {/* 保存按钮 */}
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveConfig}
                disabled={configSaving}
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {configSaving ? '保存中...' : '保存配置'}
              </Button>
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
