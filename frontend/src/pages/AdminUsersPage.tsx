import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Tooltip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Select,
  SelectItem,
  useDisclosure,
} from '@heroui/react'
import { Trash2, Key, Shield, ShieldOff, Eye, EyeOff } from 'lucide-react'
import { adminApi, type AdminUser } from '../api/admin'
import { useAuthStore } from '../stores/auth'

export function AdminUsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const createModal = useDisclosure()
  const passwordModal = useDisclosure()
  const deleteModal = useDisclosure()

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
      createModal.onClose()
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
      passwordModal.onClose()
      resetForm()
    } catch (err: any) { setFormError(err.message || '修改失败') }
    finally { setSubmitting(false) }
  }

  const handleDelete = async () => {
    if (!targetUser) return
    setSubmitting(true)
    try {
      await adminApi.deleteUser(targetUser.id)
      deleteModal.onClose()
      setTargetUser(null)
      fetchUsers()
    } catch (err: any) { setFormError(err.message || '删除失败') }
    finally { setSubmitting(false) }
  }

  const inputClassNames = {
    inputWrapper: 'bg-[#0f172a] border border-[#334155] rounded-[10px] group-data-[focus=true]:border-[#f97316] h-[48px]',
    input: 'text-[#e2e8f0] text-sm',
    label: 'text-[#94a3b8]',
  }

  if (loading) return <div className="text-center py-12 text-sm text-[#64748b]">加载中...</div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-[#e2e8f0]">用户管理</h1>
        <button
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f97316] rounded-[10px] text-white text-[13px] font-semibold hover:bg-[#ea580c] transition-colors"
          style={{ border: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
          onClick={() => { resetForm(); createModal.onOpen() }}
        >
          + 创建用户
        </button>
      </div>

      {error && (
        <div className="text-[13px] text-[#fca5a5] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg px-4 py-2.5 mb-6">
          {error}
        </div>
      )}

      {/* Table */}
      <Table
        aria-label="用户列表"
        className="bg-[#1e293b] border border-[#334155] rounded-2xl overflow-hidden"
        removeWrapper
        classNames={{
          th: 'text-left px-5 py-3.5 text-xs font-semibold text-[#64748b] uppercase tracking-wider border-b border-[#334155] bg-[#0f172a]',
          td: 'px-5 py-3.5 text-sm text-[#e2e8f0] border-b border-[#1e293b]',
        }}
      >
        <TableHeader>
          <TableColumn>用户</TableColumn>
          <TableColumn>角色</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>创建时间</TableColumn>
          <TableColumn className="text-right">操作</TableColumn>
        </TableHeader>
        <TableBody items={users} emptyContent={<div className="text-center py-12 text-sm text-[#64748b]">暂无用户</div>}>
          {(user) => (
            <TableRow key={user.id}>
              <TableCell>
                <div className="font-semibold">{user.name || '未命名'}</div>
                <div className="text-xs text-[#64748b] mt-0.5">{user.email}</div>
              </TableCell>
              <TableCell>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                  user.role === 'ADMIN' ? 'bg-[#f97316]/15 text-[#f97316]' : 'bg-[#64748b]/15 text-[#94a3b8]'
                }`}>
                  {user.role === 'ADMIN' ? <Shield size={12} /> : <ShieldOff size={12} />}
                  {user.role === 'ADMIN' ? '管理员' : '普通用户'}
                </span>
              </TableCell>
              <TableCell>
                <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                  user.status === 'ACTIVE' ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'bg-[#ef4444]/15 text-[#ef4444]'
                }`}>
                  {user.status === 'ACTIVE' ? '正常' : '已禁用'}
                </span>
              </TableCell>
              <TableCell className="text-[13px] text-[#64748b]">
                {new Date(user.createdAt).toLocaleDateString('zh-CN')}
              </TableCell>
              <TableCell>
                {user.id !== currentUser?.id && (
                  <div className="flex justify-end gap-2">
                    <Tooltip content={user.role === 'ADMIN' ? '降为普通用户' : '提升为管理员'} classNames={{ content: 'bg-[#1e293b] border border-[#334155] text-[#e2e8f0] text-xs rounded-lg' }}>
                      <button
                        className="p-1.5 border border-[#334155] rounded-lg bg-transparent text-[#94a3b8] cursor-pointer text-xs hover:bg-[#1e293b] hover:text-[#e2e8f0] transition-colors"
                        style={{ fontFamily: 'inherit' }}
                        onClick={() => handleToggleRole(user)}
                      >
                        {user.role === 'ADMIN' ? <ShieldOff size={14} /> : <Shield size={14} />}
                      </button>
                    </Tooltip>
                    <Tooltip content={user.status === 'ACTIVE' ? '禁用' : '启用'} classNames={{ content: 'bg-[#1e293b] border border-[#334155] text-[#e2e8f0] text-xs rounded-lg' }}>
                      <button
                        className="p-1.5 border border-[#334155] rounded-lg bg-transparent text-[#94a3b8] cursor-pointer text-xs hover:bg-[#1e293b] hover:text-[#e2e8f0] transition-colors"
                        style={{ fontFamily: 'inherit' }}
                        onClick={() => handleToggleStatus(user)}
                      >
                        {user.status === 'ACTIVE' ? '禁用' : '启用'}
                      </button>
                    </Tooltip>
                    <Tooltip content="修改密码" classNames={{ content: 'bg-[#1e293b] border border-[#334155] text-[#e2e8f0] text-xs rounded-lg' }}>
                      <button
                        className="p-1.5 border border-[#334155] rounded-lg bg-transparent text-[#94a3b8] cursor-pointer text-xs hover:bg-[#1e293b] hover:text-[#e2e8f0] transition-colors"
                        style={{ fontFamily: 'inherit' }}
                        onClick={() => { setFormPassword(''); setFormError(''); setShowPassword(false); setTargetUserId(user.id); passwordModal.onOpen() }}
                      >
                        <Key size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="删除用户" classNames={{ content: 'bg-[#1e293b] border border-[#334155] text-[#e2e8f0] text-xs rounded-lg' }}>
                      <button
                        className="p-1.5 border border-[#ef4444]/30 rounded-lg bg-transparent text-[#ef4444] cursor-pointer text-xs hover:bg-[#ef4444]/15 transition-colors"
                        style={{ fontFamily: 'inherit' }}
                        onClick={() => { setFormError(''); setTargetUser(user); deleteModal.onOpen() }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  </div>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* 创建用户弹窗 */}
      <Modal isOpen={createModal.isOpen} onClose={createModal.onClose} size="md" classNames={{ base: 'bg-[#1e293b] border border-[#334155] rounded-[20px]', header: 'text-lg font-semibold text-[#e2e8f0]' }}>
        <ModalContent>
          <ModalHeader>创建用户</ModalHeader>
          <ModalBody className="flex flex-col gap-3">
            {formError && <div className="text-[13px] text-[#fca5a5] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg px-4 py-2.5">{formError}</div>}
            <Input type="email" placeholder="邮箱地址" value={formEmail} onValueChange={setFormEmail} classNames={inputClassNames} />
            <Input type={showPassword ? 'text' : 'password'} placeholder="密码（至少6位）" value={formPassword} onValueChange={setFormPassword} classNames={inputClassNames}
              endContent={
                <button type="button" className="bg-transparent border-none cursor-pointer p-0 flex items-center text-[#64748b]" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />
            <Input placeholder="用户名（可选）" value={formName} onValueChange={setFormName} classNames={inputClassNames} />
            <Select
              selectedKeys={[formRole]}
              onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setFormRole(val) }}
              classNames={{ trigger: 'bg-[#0f172a] border border-[#334155] rounded-[10px] h-[48px] text-[#e2e8f0]', popoverContent: 'bg-[#1e293b] border border-[#334155]' }}
            >
              <SelectItem key="USER">普通用户</SelectItem>
              <SelectItem key="ADMIN">管理员</SelectItem>
            </Select>
          </ModalBody>
          <ModalFooter>
            <button className="px-6 py-2.5 border border-[#334155] rounded-[10px] bg-transparent text-[#94a3b8] cursor-pointer text-sm" style={{ fontFamily: 'inherit' }} onClick={createModal.onClose}>取消</button>
            <button className="px-6 py-2.5 bg-[#f97316] rounded-[10px] text-white cursor-pointer text-sm font-semibold disabled:opacity-50" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleCreate} disabled={submitting}>
              {submitting ? '创建中...' : '创建'}
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 修改密码弹窗 */}
      <Modal isOpen={passwordModal.isOpen} onClose={passwordModal.onClose} size="md" classNames={{ base: 'bg-[#1e293b] border border-[#334155] rounded-[20px]', header: 'text-lg font-semibold text-[#e2e8f0]' }}>
        <ModalContent>
          <ModalHeader>修改密码</ModalHeader>
          <ModalBody className="flex flex-col gap-3">
            {formError && <div className="text-[13px] text-[#fca5a5] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg px-4 py-2.5">{formError}</div>}
            <Input type={showPassword ? 'text' : 'password'} placeholder="新密码（至少6位）" value={formPassword} onValueChange={setFormPassword} classNames={inputClassNames}
              endContent={
                <button type="button" className="bg-transparent border-none cursor-pointer p-0 flex items-center text-[#64748b]" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />
          </ModalBody>
          <ModalFooter>
            <button className="px-6 py-2.5 border border-[#334155] rounded-[10px] bg-transparent text-[#94a3b8] cursor-pointer text-sm" style={{ fontFamily: 'inherit' }} onClick={passwordModal.onClose}>取消</button>
            <button className="px-6 py-2.5 bg-[#f97316] rounded-[10px] text-white cursor-pointer text-sm font-semibold disabled:opacity-50" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleChangePassword} disabled={submitting}>
              {submitting ? '修改中...' : '确认修改'}
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.onClose} size="md" classNames={{ base: 'bg-[#1e293b] border border-[#334155] rounded-[20px]', header: 'text-lg font-semibold text-[#e2e8f0]' }}>
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody className="flex flex-col gap-3">
            {formError && <div className="text-[13px] text-[#fca5a5] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg px-4 py-2.5">{formError}</div>}
            <p className="text-sm text-[#94a3b8] leading-relaxed">
              确定要删除用户 <strong className="text-[#e2e8f0]">{targetUser?.name || targetUser?.email}</strong> 吗？此操作不可撤销。
            </p>
          </ModalBody>
          <ModalFooter>
            <button className="px-6 py-2.5 border border-[#334155] rounded-[10px] bg-transparent text-[#94a3b8] cursor-pointer text-sm" style={{ fontFamily: 'inherit' }} onClick={deleteModal.onClose}>取消</button>
            <button className="px-6 py-2.5 bg-[#ef4444] rounded-[10px] text-white cursor-pointer text-sm font-semibold disabled:opacity-50" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleDelete} disabled={submitting}>
              {submitting ? '删除中...' : '确认删除'}
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
