import { useState, useEffect } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { GeneralSettings } from '@/components/settings/GeneralSettings'
import { DictionaryManagement } from '@/components/settings/DictionaryManagement'
import { OrphanAttachmentsSettings } from '@/components/settings/OrphanAttachmentsSettings'
import { CategoryMappingSettings } from '@/components/settings/CategoryMappingSettings'
import { AccountMappingSettings } from '@/components/settings/AccountMappingSettings'
import { ApiKeyManagement } from '@/components/settings/ApiKeyManagement'
import { useAuthStore } from '@/stores/auth'
import { AIAssistantSettings } from '@/components/ai/AISettings'
import { AIMemorySettings } from '@/components/ai/AIMemorySettings'
import { DataMigrationPanel } from '@/components/backup/DataMigrationPanel'
import { Bot, Brain, Info, ExternalLink, Database } from 'lucide-react'

export function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'

  // 关于
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => setAppVersion(d.version)).catch(() => {})
  }, [])

  // 折叠面板状态，about 默认展开
  const [accordionValue, setAccordionValue] = useState<string[]>(['about'])

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">设置</h1>

      <Accordion type="multiple" value={accordionValue} onValueChange={setAccordionValue} className="space-y-4">
        {isAdmin && <GeneralSettings />}

        {/* AI 记忆 */}
        <AccordionItem value="ai-memory" className="border rounded-xl px-5">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Brain size={16} className="text-primary-foreground" />
              </div>
              AI 记忆
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-5 space-y-6">
            <AIMemorySettings />
          </AccordionContent>
        </AccordionItem>

        {isAdmin && (<>
        {/* AI 助手 */}
        <AccordionItem value="ai-assistant" className="border rounded-xl px-5">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Bot size={16} className="text-primary-foreground" />
              </div>
              AI 助手
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-5 space-y-6">
            <AIAssistantSettings />
          </AccordionContent>
        </AccordionItem>

        {/* 字典管理 */}
        <DictionaryManagement />

        {/* 附件管理 */}
        <OrphanAttachmentsSettings />

        {/* 数据迁移 */}
        <AccordionItem value="data-migration" className="border rounded-xl px-5">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Database size={16} className="text-primary-foreground" />
              </div>
              数据迁移
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-5">
            <DataMigrationPanel />
          </AccordionContent>
        </AccordionItem>

        {/* 导入分类映射 */}
        <CategoryMappingSettings />

        {/* 导入账户映射 */}
        <AccountMappingSettings />
        </>)}

        {/* API Key 管理 */}
        <ApiKeyManagement />

        {/* 关于 */}
        <AccordionItem value="about" className="border rounded-xl px-5">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Info size={16} className="text-primary-foreground" />
              </div>
              <span>关于</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="py-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">应用</span>
                <span className="font-medium">HomiBook</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">版本</span>
                <span className="font-medium">v{appVersion || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">开发者</span>
                <span className="font-medium">saaangxy</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GitHub 仓库</span>
                <a
                  href="https://github.com/saaangxy/HomiBook"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                >
                  saaangxy/HomiBook
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
