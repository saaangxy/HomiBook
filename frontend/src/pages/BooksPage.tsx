import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useBookStore } from '../stores/book'
import { useAuthStore } from '../stores/auth'
import { bookApi, type BookItem, type BookMember, type ShareCode, type ShareCodeLookup } from '../api/book'
import { Plus, Users, Settings, Share, Trash2, Copy, LogOut, Shield, ShieldOff } from 'lucide-react'

const roleLabels: Record<string, string> = { owner: '归属人', admin: '管理员', member: '成员' }

export function BooksPage() {
  const { books, fetchBooks, removeBook } = useBookStore()
  const currentUser = useAuthStore((s) => s.user)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [joinStep, setJoinStep] = useState<'input' | 'confirm'>('input')
  const [joinCode, setJoinCode] = useState('')
  const [joinLookup, setJoinLookup] = useState<ShareCodeLookup | null>(null)
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)

  const [manageBook, setManageBook] = useState<BookItem | null>(null)
  const [manageTab, setManageTab] = useState<'members' | 'share'>('members')
  const [members, setMembers] = useState<BookMember[]>([])
  const [shareCodes, setShareCodes] = useState<ShareCode[]>([])
  const [manageLoading, setManageLoading] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addError, setAddError] = useState('')
  const [expireHours, setExpireHours] = useState('')

  const [deleteBook, setDeleteBook] = useState<BookItem | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [confirmAction, setConfirmAction] = useState<{
    title: string; description: string; onConfirm: () => void
  } | null>(null)

  const loadBooks = useCallback(async () => {
    setLoading(true)
    setError('')
    try { await fetchBooks() } catch { setError('获取账本列表失败') }
    finally { setLoading(false) }
  }, [fetchBooks])

  useEffect(() => { loadBooks() }, [loadBooks])

  const handleCreate = async () => {
    if (!createName.trim()) { setCreateError('请输入账本名称'); return }
    setCreating(true)
    try {
      await bookApi.createBook(createName.trim())
      await fetchBooks()
      setCreateOpen(false)
      setCreateName('')
      setCreateError('')
    } catch (e: any) { setCreateError(e.message || '创建失败') }
    finally { setCreating(false) }
  }

  const handleLookup = async () => {
    setJoinError('')
    try {
      const result = await bookApi.lookupCode(joinCode.trim().toUpperCase())
      setJoinLookup(result)
      setJoinStep('confirm')
    } catch (e: any) { setJoinError(e.message || '分享码无效') }
  }

  const handleJoin = async () => {
    setJoinError('')
    setJoining(true)
    try {
      await bookApi.joinByCode(joinCode.trim().toUpperCase())
      await fetchBooks()
      setJoinOpen(false)
      setJoinStep('input')
      setJoinCode('')
      setJoinLookup(null)
    } catch (e: any) { setJoinError(e.message || '加入失败') }
    finally { setJoining(false) }
  }

  const openManage = async (book: BookItem) => {
    setManageBook(book)
    setManageTab('members')
    setAddEmail('')
    setAddError('')
    setManageLoading(true)
    setManageOpen(true)
    try {
      const [m] = await Promise.all([bookApi.listMembers(book.id)])
      setMembers(m)
      if (book.role === 'owner' || book.role === 'admin') {
        const codes = await bookApi.listShareCodes(book.id)
        setShareCodes(codes)
      }
    } catch { /* ignore */ }
    finally { setManageLoading(false) }
  }

  const refreshMembers = async () => {
    if (!manageBook) return
    setMembers(await bookApi.listMembers(manageBook.id))
  }

  const refreshShareCodes = async () => {
    if (!manageBook) return
    setShareCodes(await bookApi.listShareCodes(manageBook.id))
  }

  const handleAddMember = async () => {
    if (!manageBook) return
    setAddError('')
    try {
      await bookApi.addMember(manageBook.id, addEmail.trim())
      setAddEmail('')
      await refreshMembers()
      await fetchBooks()
    } catch (e: any) { setAddError(e.message || '添加失败') }
  }

  const handleRemoveMember = async (member: BookMember) => {
    if (!manageBook) return
    try { await bookApi.removeMember(manageBook.id, member.id); await refreshMembers(); await fetchBooks() }
    catch (e: any) { setError(e.message) }
  }

  const handleToggleMemberRole = async (member: BookMember) => {
    if (!manageBook) return
    try {
      const newRole = member.role === 'admin' ? 'member' : 'admin'
      await bookApi.updateMemberRole(manageBook.id, member.id, newRole)
      await refreshMembers()
    } catch (e: any) { setError(e.message) }
  }

  const handleGenerateCode = async () => {
    if (!manageBook) return
    try {
      const hours = expireHours ? parseInt(expireHours) : undefined
      await bookApi.generateShareCode(manageBook.id, hours)
      setExpireHours('')
      await refreshShareCodes()
    } catch (e: any) { setError(e.message) }
  }

  const handleDelete = async () => {
    if (!deleteBook || deleteInput !== deleteBook.name) return
    setDeleting(true)
    try {
      await bookApi.deleteBook(deleteBook.id)
      removeBook(deleteBook.id)
      setDeleteOpen(false)
      setDeleteBook(null)
      setDeleteInput('')
    } catch (e: any) { setError(e.message) }
    finally { setDeleting(false) }
  }

  const copyCode = (code: string) => { navigator.clipboard.writeText(code).catch(() => {}) }

  if (loading && books.length === 0) {
    return <Spinner className="py-12" />
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">账本管理</h1>
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            onClick={() => { setJoinStep('input'); setJoinCode(''); setJoinError(''); setJoinLookup(null); setJoinOpen(true) }}
            className="border-border bg-card hover:border-primary rounded-lg"
          >
            <Share size={16} /> 加入账本
          </Button>
          <Button
            onClick={() => { setCreateName(''); setCreateError(''); setCreateOpen(true) }}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
          >
            <Plus size={16} /> 创建账本
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 账本列表 */}
      {books.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <p className="text-base">暂无账本</p>
            <p className="text-[13px] text-muted-foreground">创建你的第一个账本，或通过分享码加入他人的账本</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {books.map((book) => (
            <Card key={book.id} className="rounded-xl hover:border-[#475569] transition-colors">
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[17px] font-semibold">{book.name}</div>
                    <Badge variant={book.role === 'owner' ? 'default' : 'secondary'} className="text-[11px] mt-1">
                      {roleLabels[book.role] || book.role}
                    </Badge>
                  </div>
                  <div className="flex gap-1.5">
                    {(book.role === 'owner' || book.role === 'admin') && (
                      <Button
                        variant="outline"
                        size="icon"
                        title="管理账本"
                        onClick={() => openManage(book)}
                        className="w-[34px] h-[34px] rounded-lg border-border bg-background text-muted-foreground hover:border-primary hover:text-primary"
                      >
                        <Settings size={16} />
                      </Button>
                    )}
                    {book.role === 'owner' && (
                      <Button
                        variant="outline"
                        size="icon"
                        title="删除账本"
                        onClick={() => { setDeleteBook(book); setDeleteInput(''); setDeleteOpen(true) }}
                        className="w-[34px] h-[34px] rounded-lg border-border bg-background text-[#ef4444] hover:border-[#ef4444]"
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                    {book.role !== 'owner' && (
                      <Button
                        variant="outline"
                        size="icon"
                        title="退出账本"
                        onClick={() => setConfirmAction({
                          title: '退出账本',
                          description: '确定退出该账本吗？',
                          onConfirm: async () => {
                            try {
                              const m = await bookApi.listMembers(book.id)
                              const self = m.find((m) => m.userId === currentUser?.id)
                              if (self) { await bookApi.removeMember(book.id, self.id); await fetchBooks() }
                            } catch (e: any) { setError(e.message) }
                            setConfirmAction(null)
                          },
                        })}
                        className="w-[34px] h-[34px] rounded-lg border-border bg-background text-[#ef4444] hover:border-[#ef4444]"
                      >
                        <LogOut size={16} />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Users size={14} /> {book.memberCount} 人</span>
                  <span>{new Date(book.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 创建账本弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建账本</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Input
              aria-label="账本名称"
              placeholder="输入账本名称"
              value={createName}
              onChange={(e) => { setCreateName(e.target.value); setCreateError('') }}
              autoFocus
              className="bg-background border-border"
            />
            {createError && <Alert variant="destructive"><AlertDescription>{createError}</AlertDescription></Alert>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleCreate} disabled={creating}>
              {creating ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 加入账本弹窗 */}
      <Dialog open={joinOpen} onOpenChange={(open) => { setJoinOpen(open); if (!open) setJoinStep('input') }}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>加入账本</DialogTitle>
          </DialogHeader>
          {joinStep === 'input' ? (
            <>
              <div className="flex flex-col gap-4">
                <Input
                  aria-label="分享码"
                  className="bg-background border-border text-center tracking-[4px]"
                  style={{ textTransform: 'uppercase' }}
                  placeholder="输入8位分享码"
                  value={joinCode}
                  onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError('') }}
                  autoFocus
                  maxLength={8}
                />
                {joinError && <Alert variant="destructive"><AlertDescription>{joinError}</AlertDescription></Alert>}
                <p className="text-xs text-muted-foreground">由账本归属人在管理面板生成分享码</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setJoinOpen(false)}>取消</Button>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleLookup} disabled={joinCode.length < 1}>
                  验证
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-4 text-center">
                <p className="text-base">
                  确认加入 <strong className="text-primary">{joinLookup?.bookName}</strong>？
                </p>
                {joinLookup?.expiresAt && (
                  <p className="text-[13px] text-muted-foreground">分享码有效期至 {new Date(joinLookup.expiresAt).toLocaleString('zh-CN')}</p>
                )}
                {joinError && <Alert variant="destructive"><AlertDescription>{joinError}</AlertDescription></Alert>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setJoinStep('input'); setJoinError('') }}>返回</Button>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleJoin} disabled={joining}>
                  {joining ? '加入中...' : '确认加入'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 管理面板弹窗 */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogTrigger />
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{manageBook?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Tabs value={manageTab} onValueChange={(v) => setManageTab(v as 'members' | 'share')}>
              <TabsList className="w-full">
                <TabsTrigger value="members" className="flex-1">成员管理</TabsTrigger>
                {manageBook && (manageBook.role === 'owner' || manageBook.role === 'admin') && (
                  <TabsTrigger value="share" className="flex-1">分享码</TabsTrigger>
                )}
              </TabsList>
            </Tabs>

            {manageLoading ? (
              <Spinner className="py-6" />
            ) : (
              <>
                {manageTab === 'members' && (
                  <div className="flex flex-col gap-3">
                    {(manageBook?.role === 'owner' || manageBook?.role === 'admin') && (
                      <div className="flex gap-2 mb-2">
                        <Input
                          aria-label="用户邮箱"
                          className="flex-1 bg-background border-border"
                          placeholder="输入用户邮箱添加成员"
                          value={addEmail}
                          onChange={(e) => { setAddEmail(e.target.value); setAddError('') }}
                        />
                        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleAddMember}>
                          添加
                        </Button>
                      </div>
                    )}
                    {addError && <Alert variant="destructive" className="mt-1"><AlertDescription>{addError}</AlertDescription></Alert>}

                    {members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {m.user.nickname || m.user.email}
                            {m.userId === manageBook?.ownerId && (
                              <Badge className="ml-2 text-[10px]">归属人</Badge>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{m.user.email}</span>
                        </div>
                        <div className="flex gap-1.5 items-center">
                          {manageBook?.role === 'owner' && m.userId !== manageBook.ownerId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleMemberRole(m)}
                              title={m.role === 'admin' ? '降为成员' : '提升为管理员'}
                              className="text-xs border-border text-muted-foreground hover:bg-accent rounded-md"
                            >
                              {m.role === 'admin' ? <ShieldOff size={14} /> : <Shield size={14} />}
                              <span className="ml-1">{m.role === 'admin' ? '降为成员' : '提升管理'}</span>
                            </Button>
                          )}
                          {(manageBook?.role === 'owner' || manageBook?.role === 'admin') && m.userId !== manageBook.ownerId && m.userId !== currentUser?.id && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmAction({
                                title: '移除成员',
                                description: `确定移除 ${m.user.nickname || m.user.email}？`,
                                onConfirm: () => { handleRemoveMember(m); setConfirmAction(null) },
                              })}
                              className="text-xs border-[#7f1d1d] bg-[#ef4444]/10 text-[#ef4444] rounded-md"
                            >
                              移除
                            </Button>
                          )}
                          {(manageBook?.role === 'owner' || manageBook?.role === 'admin') && currentUser?.id === m.userId && manageBook?.role !== 'owner' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmAction({
                                title: '退出账本',
                                description: '确定退出该账本？',
                                onConfirm: () => { handleRemoveMember(m); setConfirmAction(null) },
                              })}
                              className="text-xs border-[#7f1d1d] bg-[#ef4444]/10 text-[#ef4444] rounded-md"
                            >
                              <LogOut size={14} className="mr-1" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && (
                      <div className="text-center py-4 text-sm text-muted-foreground">暂无成员</div>
                    )}
                  </div>
                )}

                {manageTab === 'share' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2 items-end mb-4">
                      <div className="flex-1">
                        <Label className="block text-xs text-muted-foreground mb-1">有效期（小时，留空永久）</Label>
                        <Input
                          aria-label="有效期小时"
                          type="number" min={1} max={720}
                          className="bg-background border-border"
                          placeholder="留空 = 永久有效"
                          value={expireHours}
                          onChange={(e) => setExpireHours(e.target.value)}
                        />
                      </div>
                      <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleGenerateCode}>
                        生成
                      </Button>
                    </div>

                    {shareCodes.map((sc) => (
                      <div key={sc.id} className="flex items-center justify-between px-3.5 py-2.5 bg-background border border-border rounded-lg">
                        <div>
                          <div className="text-base font-bold text-primary tracking-[2px]" style={{ fontFamily: 'monospace' }}>{sc.code}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {sc.expiresAt ? `有效期至 ${new Date(sc.expiresAt).toLocaleString('zh-CN')}` : '永久有效'}
                            {sc.isExpired && <span className="text-[#ef4444] ml-2">已过期</span>}
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyCode(sc.code)}
                            className="text-xs border-border text-muted-foreground hover:bg-accent rounded-md"
                          >
                            <Copy size={14} /> 复制
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              if (!manageBook) return
                              try { await bookApi.deleteShareCode(manageBook.id, sc.id); await refreshShareCodes() }
                              catch (e: any) { setError(e.message) }
                            }}
                            className="text-xs border-[#7f1d1d] bg-[#ef4444]/10 text-[#ef4444] rounded-md"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {shareCodes.length === 0 && (
                      <div className="text-center py-4 text-sm text-muted-foreground">暂无分享码</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除账本</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              确定要删除 <strong className="text-[#ef4444]">{deleteBook?.name}</strong> 吗？所有记录将被永久删除，此操作不可撤销。
            </p>
            <p className="text-[13px] text-muted-foreground">
              请输入账本名称 <strong>{deleteBook?.name}</strong> 确认删除
            </p>
            <Input
              aria-label="确认删除账本名称"
              className="bg-background border-border"
              placeholder="输入账本名称确认"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button
              onClick={handleDelete}
              disabled={deleteInput !== deleteBook?.name || deleting}
              className="bg-[#ef4444] hover:bg-[#dc2626] text-white disabled:opacity-50"
            >
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 确认弹窗 */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={confirmAction?.onConfirm}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
