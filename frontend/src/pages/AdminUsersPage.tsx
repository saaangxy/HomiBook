import { useState, useEffect, useCallback } from 'react'
import { Trash2, Key, Shield, ShieldOff, UserPlus } from 'lucide-react'
import { adminApi, type AdminUser } from '../api/admin'
import { useAuthStore } from '../stores/auth'

// 样式
const s = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '24px',
  } as React.CSSProperties,

  title: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#e2e8f0',
  } as React.CSSProperties,

  btnPrimary: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#f97316',
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,

  table: {
    width: '100%',
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '16px',
    overflow: 'hidden',
  } as React.CSSProperties,

  th: {
    textAlign: 'left',
    padding: '14px 20px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid #334155',
    background: '#0f172a',
  } as React.CSSProperties,

  td: {
    padding: '14px 20px',
    fontSize: '14px',
    color: '#e2e8f0',
    borderBottom: '1px solid #1e293b',
  } as React.CSSProperties,

  badge: (role: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 600,
    backgroundColor: role === 'ADMIN' ? 'rgba(249, 115, 22, 0.15)' : 'rgba(100, 116, 139, 0.15)',
    color: role === 'ADMIN' ? '#f97316' : '#94a3b8',
  } as React.CSSProperties),

  statusBadge: (status: string) => ({
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 600,
    backgroundColor: status === 'ACTIVE' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
    color: status === 'ACTIVE' ? '#22c55e' : '#ef4444',
  } as React.CSSProperties),

  actionBtn: {
    padding: '6px 10px',
    border: '1px solid #334155',
    borderRadius: '8px',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'inherit',
    marginRight: '8px',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,

  dangerBtn: {
    padding: '6px 10px',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '8px',
    backgroundColor: 'transparent',
    color: '#ef4444',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,

  // Modal overlay
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as React.CSSProperties,

  modal: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '20px',
    padding: '32px',
    width: '420px',
    maxWidth: '90vw',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  } as React.CSSProperties,

  modalTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '24px',
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '10px',
    color: '#e2e8f0',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    marginBottom: '12px',
    boxSizing: 'border-box',
  } as React.CSSProperties,

  select: {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '10px',
    color: '#e2e8f0',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    marginBottom: '12px',
    boxSizing: 'border-box',
  } as React.CSSProperties,

  modalActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '24px',
  } as React.CSSProperties,

  cancelBtn: {
    padding: '10px 24px',
    border: '1px solid #334155',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  submitBtn: {
    padding: '10px 24px',
    border: 'none',
    borderRadius: '10px',
    backgroundColor: '#f97316',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: 'inherit',
  } as React.CSSProperties,

  emptyState: {
    textAlign: 'center',
    padding: '48px 24px',
    color: '#64748b',
    fontSize: '14px',
  } as React.CSSProperties,

  errorText: {
    color: '#fca5a5',
    fontSize: '13px',
    marginBottom: '12px',
    padding: '10px 14px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '8px',
  } as React.CSSProperties,
}

// 模态框组件
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={s.modalTitle}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function AdminUsersPage() {
  const currentUser = useAuthStore((st) => st.user)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 模态框状态
  const [showCreate, setShowCreate] = useState(false)
  const [showPassword, setShowPassword] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState<AdminUser | null>(null)

  // 表单状态
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formName, setFormName] = useState('')
  const [formRole, setFormRole] = useState('USER')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // 创建用户
  const handleCreate = async () => {
    setFormError('')
    if (!formEmail || !formPassword) {
      setFormError('请填写邮箱和密码')
      return
    }
    if (formPassword.length < 6) {
      setFormError('密码至少6位')
      return
    }
    setSubmitting(true)
    try {
      await adminApi.createUser({ email: formEmail, password: formPassword, name: formName || undefined, role: formRole })
      setShowCreate(false)
      resetForm()
      fetchUsers()
    } catch (err: any) {
      setFormError(err.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 切换角色
  const handleToggleRole = async (user: AdminUser) => {
    const newRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN'
    try {
      await adminApi.updateUser(user.id, { role: newRole })
      fetchUsers()
    } catch (err: any) {
      setError(err.message || '操作失败')
    }
  }

  // 切换状态
  const handleToggleStatus = async (user: AdminUser) => {
    const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      await adminApi.updateUser(user.id, { status: newStatus })
      fetchUsers()
    } catch (err: any) {
      setError(err.message || '操作失败')
    }
  }

  // 修改密码
  const handleChangePassword = async () => {
    if (!showPassword) return
    setFormError('')
    if (formPassword.length < 6) {
      setFormError('密码至少6位')
      return
    }
    setSubmitting(true)
    try {
      await adminApi.changePassword(showPassword, formPassword)
      setShowPassword(null)
      resetForm()
    } catch (err: any) {
      setFormError(err.message || '修改失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 删除用户
  const handleDelete = async () => {
    if (!showDelete) return
    setSubmitting(true)
    try {
      await adminApi.deleteUser(showDelete.id)
      setShowDelete(null)
      fetchUsers()
    } catch (err: any) {
      setFormError(err.message || '删除失败')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setFormEmail('')
    setFormPassword('')
    setFormName('')
    setFormRole('USER')
    setFormError('')
    setSubmitting(false)
  }

  if (loading) {
    return <div style={s.emptyState}>加载中...</div>
  }

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>用户管理</h1>
        <button
          style={s.btnPrimary}
          onClick={() => {
            resetForm()
            setShowCreate(true)
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#ea580c' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f97316' }}
        >
          <UserPlus size={16} />
          创建用户
        </button>
      </div>

      {error && <div style={s.errorText}>{error}</div>}

      <div style={s.table}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={s.th}>用户</th>
              <th style={s.th}>角色</th>
              <th style={s.th}>状态</th>
              <th style={s.th}>创建时间</th>
              <th style={{ ...s.th, textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td style={s.td}>
                  <div style={{ fontWeight: 600 }}>{user.name || '未命名'}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{user.email}</div>
                </td>
                <td style={s.td}>
                  <span style={s.badge(user.role)}>
                    {user.role === 'ADMIN' ? <Shield size={12} /> : <ShieldOff size={12} />}
                    {user.role === 'ADMIN' ? '管理员' : '普通用户'}
                  </span>
                </td>
                <td style={s.td}>
                  <span style={s.statusBadge(user.status)}>
                    {user.status === 'ACTIVE' ? '正常' : '已禁用'}
                  </span>
                </td>
                <td style={{ ...s.td, color: '#64748b', fontSize: '13px' }}>
                  {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                </td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  {user.id !== currentUser?.id && (
                    <>
                      <button
                        style={s.actionBtn}
                        onClick={() => handleToggleRole(user)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#1e293b'
                          e.currentTarget.style.color = '#e2e8f0'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                          e.currentTarget.style.color = '#94a3b8'
                        }}
                        title={user.role === 'ADMIN' ? '降为普通用户' : '提升为管理员'}
                      >
                        {user.role === 'ADMIN' ? <ShieldOff size={14} /> : <Shield size={14} />}
                      </button>
                      <button
                        style={s.actionBtn}
                        onClick={() => handleToggleStatus(user)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#1e293b'
                          e.currentTarget.style.color = '#e2e8f0'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                          e.currentTarget.style.color = '#94a3b8'
                        }}
                        title={user.status === 'ACTIVE' ? '禁用账户' : '启用账户'}
                      >
                        {user.status === 'ACTIVE' ? '禁用' : '启用'}
                      </button>
                      <button
                        style={s.actionBtn}
                        onClick={() => {
                          setFormPassword('')
                          setFormError('')
                          setShowPassword(user.id)
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#1e293b'
                          e.currentTarget.style.color = '#e2e8f0'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                          e.currentTarget.style.color = '#94a3b8'
                        }}
                        title="修改密码"
                      >
                        <Key size={14} />
                      </button>
                      <button
                        style={s.dangerBtn}
                        onClick={() => {
                          setFormError('')
                          setShowDelete(user)
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                        }}
                        title="删除用户"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 创建用户模态框 */}
      {showCreate && (
        <Modal title="创建用户" onClose={() => setShowCreate(false)}>
          {formError && <div style={s.errorText}>{formError}</div>}
          <input
            style={s.input}
            placeholder="邮箱地址"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
          />
          <input
            style={s.input}
            type="password"
            placeholder="密码（至少6位）"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
          />
          <input
            style={s.input}
            placeholder="用户名（可选）"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
          <select style={s.select} value={formRole} onChange={(e) => setFormRole(e.target.value)}>
            <option value="USER">普通用户</option>
            <option value="ADMIN">管理员</option>
          </select>
          <div style={s.modalActions}>
            <button style={s.cancelBtn} onClick={() => setShowCreate(false)}>取消</button>
            <button style={s.submitBtn} onClick={handleCreate} disabled={submitting}>
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </Modal>
      )}

      {/* 修改密码模态框 */}
      {showPassword && (
        <Modal title="修改密码" onClose={() => setShowPassword(null)}>
          {formError && <div style={s.errorText}>{formError}</div>}
          <input
            style={s.input}
            type="password"
            placeholder="新密码（至少6位）"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
          />
          <div style={s.modalActions}>
            <button style={s.cancelBtn} onClick={() => setShowPassword(null)}>取消</button>
            <button style={s.submitBtn} onClick={handleChangePassword} disabled={submitting}>
              {submitting ? '修改中...' : '确认修改'}
            </button>
          </div>
        </Modal>
      )}

      {/* 删除确认模态框 */}
      {showDelete && (
        <Modal title="确认删除" onClose={() => setShowDelete(null)}>
          {formError && <div style={s.errorText}>{formError}</div>}
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>
            确定要删除用户 <strong style={{ color: '#e2e8f0' }}>{showDelete.name || showDelete.email}</strong> 吗？此操作不可撤销。
          </p>
          <div style={s.modalActions}>
            <button style={s.cancelBtn} onClick={() => setShowDelete(null)}>取消</button>
            <button
              style={{ ...s.submitBtn, backgroundColor: '#ef4444' }}
              onClick={handleDelete}
              disabled={submitting}
            >
              {submitting ? '删除中...' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
