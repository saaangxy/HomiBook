import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Brain, Pencil, Trash2 } from 'lucide-react'
import { fetchMemories, deleteMemory as deleteMemoryApi, updateMemory as updateMemoryApi, type UserMemory } from '@/api/chat'

const MEMORY_TYPE_LABELS: Record<string, string> = {
  habit: '习惯',
  preference: '偏好',
  rule: '规则',
  fact: '事实',
}

export function AIMemorySettings() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [memories, setMemories] = useState<UserMemory[]>([])
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editMemoryContent, setEditMemoryContent] = useState('')
  const [editMemoryImportance, setEditMemoryImportance] = useState('')

  useEffect(() => { loadMemories() }, [])

  const loadMemories = async () => {
    setLoading(true)
    try {
      setMemories(await fetchMemories())
    } catch {
      setError('加载记忆失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await deleteMemoryApi(id)
      setMemories((prev) => prev.filter((m) => m.id !== id))
    } catch (err: any) {
      setError(err.message || '删除记忆失败')
    }
  }

  const startEditMemory = (m: UserMemory) => {
    setEditingMemoryId(m.id)
    setEditMemoryContent(m.content)
    setEditMemoryImportance(String(m.importance))
  }

  const handleSaveMemoryEdit = async () => {
    if (!editingMemoryId) return
    const importance = parseFloat(editMemoryImportance)
    if (isNaN(importance) || importance < 0 || importance > 1) {
      setError('重要程度需为 0-1 之间的数字')
      return
    }
    try {
      await updateMemoryApi(editingMemoryId, { content: editMemoryContent, importance })
      setMemories((prev) => prev.map((m) =>
        m.id === editingMemoryId ? { ...m, content: editMemoryContent, importance } : m,
      ))
      setEditingMemoryId(null)
      setError('')
    } catch (err: any) {
      setError(err.message || '更新记忆失败')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Brain size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold">记忆管理</span>
        </div>
        {memories.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">
            暂无记忆。AI 会在对话中自动识别您的消费习惯和记账偏好并保存。
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map((m) => (
              <div key={m.id} className="p-3 border rounded-lg">
                {editingMemoryId === m.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editMemoryContent}
                      onChange={(e) => setEditMemoryContent(e.target.value)}
                      className="text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="1"
                        value={editMemoryImportance}
                        onChange={(e) => setEditMemoryImportance(e.target.value)}
                        className="text-sm w-24"
                        placeholder="重要度 0-1"
                      />
                      <Button size="sm" onClick={handleSaveMemoryEdit}>保存</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingMemoryId(null)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {MEMORY_TYPE_LABELS[m.memoryType] || m.memoryType}
                        </span>
                        <span className="text-xs text-muted-foreground">重要度 {m.importance.toFixed(1)}</span>
                      </div>
                      <div className="text-sm">{m.content}</div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => startEditMemory(m)}>
                      <Pencil size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDeleteMemory(m.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
