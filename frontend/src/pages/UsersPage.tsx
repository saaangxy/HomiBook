import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Trash2, Key, Shield, ShieldOff, Eye, EyeOff } from 'lucide-react'
import { adminApi, type AdminUser } from '../api/admin'
import { useAuthStore } from '../stores/auth'

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formName, setFormName] = useState('')
  const [formRole, setFormRole] = useState('USER')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [targetUser, setTargetUser] = useState<AdminUser | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const fetchUsers = useCallback(async () => {
    try {
      setError('')
      const data = await adminApi.listUsers()
      setUsers(data)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const resetForm = () => {
    setFormEmail('')
    setFormPassword('')
    setFormName('')
    setFormRole('USER')
    setFormError('')
    setSubmitting(false)
    setShowPassword(false)
  }

  const handleCreate = async () => {
    setFormError('')
    if (!formEmail || !formPassword) { setFormError('请填写邮箱和密码'); return }
    if (formPassword.length < 6) { setFormError('密码至少6位'); return }
    setSubmitting(true)
    try {
      await adminApi.createUser({ email: formEmail, password: formPassword, name: formName || undefined, role: formRole })
      setCreateOpen(false)
      resetForm()
      fetchUsers()
    } catch (err: any) { setFormError(err.message || '创建失败') }
    finally { setSubmitting(false) }
  }

  const handleToggleRole = async (user: AdminUser) => {
    const newRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN'
    try {
      await adminApi.updateUser(user.id, { role: newRole })
      fetchUsers()
    } catch (err: any) { setError(err.message || '操作失败') }
  }

  const handleToggleStatus = async (user: AdminUser) => {
    const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      await adminApi.updateUser(user.id, { status: newStatus })
      fetchUsers()
    } catch (err: any) { setError(err.message || '操作失败') }
  }

  const handleChangePassword = async () => {
    if (!targetUserId) return
    setFormError('')
    if (formPassword.length < 6) { setFormError('密码至少6位'); return }
    setSubmitting(true)
    try {
      await adminApi.changePassword(targetUserId, formPassword)
      setPasswordOpen(false)
      resetForm()
    } catch (err: any) { setFormError(err.message || '修改失败') }
    finally { setSubmitting(false) }
  }

  const handleDelete = async () => {
    if (!targetUser) return
    setSubmitting(true)
    try {
      await adminApi.deleteUser(targetUser.id)
      setDeleteOpen(false)
      setTargetUser(null)
      fetchUsers()
    } catch (err: any) { setFormError(err.message || '删除失败') }
    finally { setSubmitting(false) }
  }

  if (loading) return <Spinner className="py-12" />

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">用户管理</h1>
        <Button
          className="bg-[#f97316] hover:bg-[#ea580c] text-white rounded-[10px]"
          onClick={() => { resetForm(); setCreateOpen(true) }}
        >
          + 创建用户
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border bg-background hover:bg-background">
              <TableHead className="text-left px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">用户</TableHead>
              <TableHead className="text-left px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">角色</TableHead>
              <TableHead className="text-left px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">状态</TableHead>
              <TableHead className="text-left px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">创建时间</TableHead>
              <TableHead className="text-right px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-sm text-muted-foreground">暂无用户</TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id} className="border-b border-border">
                  <TableCell className="px-5 py-3.5 text-sm">
                    <div className="font-semibold">{user.name || '未命名'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{user.email}</div>
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-sm">
                    <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'} className="inline-flex items-center gap-1 text-xs">
                      {user.role === 'ADMIN' ? <Shield size={12} /> : <ShieldOff size={12} />}
                      {user.role === 'ADMIN' ? '管理员' : '普通用户'}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-sm">
                    <Badge
                      variant={user.status === 'ACTIVE' ? 'secondary' : 'destructive'}
                      className={user.status === 'ACTIVE' ? 'bg-[#22c55e]/15 text-[#22c55e] hover:bg-[#22c55e]/20' : 'text-xs'}
                    >
                      {user.status === 'ACTIVE' ? '正常' : '已禁用'}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-[13px] text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-sm">
                    {user.id !== currentUser?.id && (
                      <div className="flex justify-end gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              aria-label="权限管理"
                              variant="outline"
                              size="icon"
                              onClick={() => handleToggleRole(user)}
                              className="h-8 w-8 border-border text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg"
                            >
                              {user.role === 'ADMIN' ? <ShieldOff size={14} /> : <Shield size={14} />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{user.role === 'ADMIN' ? '降为普通用户' : '提升为管理员'}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              aria-label="启用禁用"
                              variant="outline"
                              size="icon"
                              onClick={() => handleToggleStatus(user)}
                              className="h-8 w-8 border-border text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg"
                            >
                              {user.status === 'ACTIVE' ? '禁用' : '启用'}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{user.status === 'ACTIVE' ? '禁用' : '启用'}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              aria-label="修改密码"
                              variant="outline"
                              size="icon"
                              onClick={() => { setFormPassword(''); setFormError(''); setShowPassword(false); setTargetUserId(user.id); setPasswordOpen(true) }}
                              className="h-8 w-8 border-border text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg"
                            >
                              <Key size={14} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>修改密码</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              aria-label="删除用户"
                              variant="outline"
                              size="icon"
                              onClick={() => { setFormError(''); setTargetUser(user); setDeleteOpen(true) }}
                              className="h-8 w-8 border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/15 rounded-lg"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>删除用户</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 创建用户弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建用户</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <Input aria-label="邮箱" type="email" placeholder="邮箱地址" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="bg-background border-border h-11 rounded-[10px]" />
            <div className="relative">
              <Input
                aria-label="密码"
                type={showPassword ? 'text' : 'password'}
                placeholder="密码（至少6位）"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                className="bg-background border-border h-11 rounded-[10px] pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <Input aria-label="用户名" placeholder="用户名（可选）" value={formName} onChange={(e) => setFormName(e.target.value)} className="bg-background border-border h-11 rounded-[10px]" />
            <Select value={formRole} onValueChange={setFormRole}>
              <SelectTrigger className="bg-background border-border h-11 rounded-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="USER">普通用户</SelectItem>
                <SelectItem value="ADMIN">管理员</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={handleCreate} disabled={submitting}>
              {submitting ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改密码弹窗 */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <div className="relative">
              <Input
                aria-label="新密码"
                type={showPassword ? 'text' : 'password'}
                placeholder="新密码（至少6位）"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                className="bg-background border-border h-11 rounded-[10px] pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>取消</Button>
            <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={handleChangePassword} disabled={submitting}>
              {submitting ? '修改中...' : '确认修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <p className="text-sm text-muted-foreground leading-relaxed">
              确定要删除用户 <strong className="text-foreground">{targetUser?.name || targetUser?.email}</strong> 吗？此操作不可撤销。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button className="bg-[#ef4444] hover:bg-[#dc2626] text-white" onClick={handleDelete} disabled={submitting}>
              {submitting ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
