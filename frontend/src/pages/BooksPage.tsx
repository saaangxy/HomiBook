import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookStore } from '../stores/book'
import { useAuthStore } from '../stores/auth'
import { bookApi, type BookItem, type BookMember, type ShareCode, type ShareCodeLookup } from '../api/book'
import { Plus, Users, Settings, Share, Trash2, Copy, X, LogOut, Shield, ShieldOff } from 'lucide-react'
import type React from 'react'

/* ===== 内联样式 ===== */
const st = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24,
  } as React.CSSProperties,
  title: {
    fontSize: 20, fontWeight: 700, color: '#e2e8f0',
  } as React.CSSProperties,
  headerBtns: {
    display: 'flex', gap: 10,
  } as React.CSSProperties,
  btnSecondary: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 18px', borderRadius: 8,
    border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0',
    cursor: 'pointer', fontSize: 14, fontWeight: 500,
  } as React.CSSProperties,
  btnPrimary: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 18px', borderRadius: 8,
    border: 'none', background: '#f97316', color: '#fff',
    cursor: 'pointer', fontSize: 14, fontWeight: 600,
  } as React.CSSProperties,
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16,
  } as React.CSSProperties,
  card: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px',
    display: 'flex', flexDirection: 'column', gap: 16, transition: 'border-color 0.2s',
  } as React.CSSProperties,
  cardTop: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
  } as React.CSSProperties,
  cardName: {
    fontSize: 17, fontWeight: 600, color: '#e2e8f0',
  } as React.CSSProperties,
  cardInfo: {
    display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: '#94a3b8',
  } as React.CSSProperties,
  cardActions: {
    display: 'flex', gap: 6,
  } as React.CSSProperties,
  iconBtn: (danger: boolean) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
    border: '1px solid #334155', background: '#0f172a', color: danger ? '#ef4444' : '#94a3b8',
    transition: 'border-color 0.15s',
  }),
  badge: (role: string) => ({
    fontSize: 11, padding: '2px 10px', borderRadius: 10, fontWeight: 600,
    background: role === 'owner' ? 'rgba(249,115,22,0.15)' : 'rgba(100,116,139,0.15)',
    color: role === 'owner' ? '#f97316' : '#94a3b8',
  }),

  // 弹窗
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200,
  } as React.CSSProperties,
  modal: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 16,
    padding: 28, width: 440, maxHeight: '80vh', overflow: 'auto',
  } as React.CSSProperties,
  modalWide: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 16,
    padding: 28, width: 560, maxHeight: '80vh', overflow: 'auto',
  } as React.CSSProperties,
  modalTitle: {
    fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 20,
  } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #334155',
    background: '#0f172a', color: '#e2e8f0', fontSize: 14, outline: 'none',
    boxSizing: 'border-box' as const,
  },
  modalActions: {
    display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20,
  } as React.CSSProperties,
  cancelBtn: {
    padding: '8px 20px', borderRadius: 8, border: '1px solid #334155',
    background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14,
  } as React.CSSProperties,
  submitBtn: {
    padding: '8px 20px', borderRadius: 8, border: 'none',
    background: '#f97316', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  } as React.CSSProperties,
  errorText: {
    color: '#ef4444', fontSize: 13, marginTop: 6,
  } as React.CSSProperties,
  tipText: {
    color: '#64748b', fontSize: 12, marginTop: 6,
  } as React.CSSProperties,

  // 成员/分享码面板
  tabs: {
    display: 'flex', gap: 0, borderBottom: '1px solid #334155', marginBottom: 16,
  } as React.CSSProperties,
  tab: (active: boolean) => ({
    padding: '8px 16px', fontSize: 14, fontWeight: active ? 600 : 400,
    color: active ? '#f97316' : '#94a3b8',
    borderBottom: active ? '2px solid #f97316' : '2px solid transparent',
    cursor: 'pointer', background: 'none', border: 'none', outline: 'none',
  }),
  memberRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 0', borderBottom: '1px solid #1e293b',
  } as React.CSSProperties,
  memberInfo: {
    display: 'flex', flexDirection: 'column', gap: 2,
  } as React.CSSProperties,
  memberName: {
    fontSize: 14, fontWeight: 500, color: '#e2e8f0',
  } as React.CSSProperties,
  memberEmail: {
    fontSize: 12, color: '#64748b',
  } as React.CSSProperties,
  codeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#0f172a', borderRadius: 8, border: '1px solid #334155',
    marginBottom: 8,
  } as React.CSSProperties,
  codeText: {
    fontSize: 16, fontWeight: 700, color: '#f97316', fontFamily: 'monospace', letterSpacing: 2,
  } as React.CSSProperties,
  btnSmall: (danger: boolean) => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
    border: danger ? '1px solid #7f1d1d' : '1px solid #334155',
    background: danger ? 'rgba(239,68,68,0.1)' : 'transparent',
    color: danger ? '#ef4444' : '#94a3b8',
  }),
  emptyState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 48, color: '#64748b',
  } as React.CSSProperties,
  addMemberForm: {
    display: 'flex', gap: 8, marginTop: 12,
  } as React.CSSProperties,
}

const roleLabels: Record<string, string> = {
  owner: '归属人',
  admin: '管理员',
  member: '成员',
}

/* ===== Modal 组件 ===== */
function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={wide ? st.modalWide : st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={st.modalTitle}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ===== 主组件 ===== */
export function BooksPage() {
  const navigate = useNavigate()
  const { books, fetchBooks, removeBook, setCurrentBook } = useBookStore()
  const currentUser = useAuthStore((s) => s.user)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 创建账本
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')

  // 加入账本
  const [showJoin, setShowJoin] = useState(false)
  const [joinStep, setJoinStep] = useState<'input' | 'confirm'>('input')
  const [joinCode, setJoinCode] = useState('')
  const [joinLookup, setJoinLookup] = useState<ShareCodeLookup | null>(null)
  const [joinError, setJoinError] = useState('')

  // 管理面板
  const [manageBook, setManageBook] = useState<BookItem | null>(null)
  const [manageTab, setManageTab] = useState<'members' | 'share'>('members')
  const [members, setMembers] = useState<BookMember[]>([])
  const [shareCodes, setShareCodes] = useState<ShareCode[]>([])
  const [manageLoading, setManageLoading] = useState(false)

  // 添加成员
  const [addEmail, setAddEmail] = useState('')
  const [addError, setAddError] = useState('')

  // 删除确认
  const [showDelete, setShowDelete] = useState<BookItem | null>(null)
  const [deleteInput, setDeleteInput] = useState('')

  // 分享码过期时间
  const [expireHours, setExpireHours] = useState<number | undefined>(undefined)

  const loadBooks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await fetchBooks()
    } catch {
      setError('获取账本列表失败')
    } finally {
      setLoading(false)
    }
  }, [fetchBooks])

  useEffect(() => { loadBooks() }, [loadBooks])

  // ===== 创建账本 =====
  const handleCreate = async () => {
    if (!createName.trim()) {
      setCreateError('请输入账本名称')
      return
    }
    try {
      await bookApi.createBook(createName.trim())
      await fetchBooks()
      setShowCreate(false)
      setCreateName('')
      setCreateError('')
    } catch (e: any) {
      setCreateError(e.message || '创建失败')
    }
  }

  // ===== 加入账本 =====
  const handleLookup = async () => {
    setJoinError('')
    try {
      const result = await bookApi.lookupCode(joinCode.trim().toUpperCase())
      setJoinLookup(result)
      setJoinStep('confirm')
    } catch (e: any) {
      setJoinError(e.message || '分享码无效')
    }
  }

  const handleJoin = async () => {
    setJoinError('')
    try {
      await bookApi.joinByCode(joinCode.trim().toUpperCase())
      await fetchBooks()
      setShowJoin(false)
      setJoinStep('input')
      setJoinCode('')
      setJoinLookup(null)
    } catch (e: any) {
      setJoinError(e.message || '加入失败')
    }
  }

  // ===== 管理面板 =====
  const openManage = async (book: BookItem) => {
    setManageBook(book)
    setManageTab('members')
    setAddEmail('')
    setAddError('')
    setManageLoading(true)
    try {
      const [m, ...rest] = await Promise.all([bookApi.listMembers(book.id)])
      setMembers(m)
      if (book.role === 'owner') {
        const codes = await bookApi.listShareCodes(book.id)
        setShareCodes(codes)
      }
    } catch {
      // ignore
    } finally {
      setManageLoading(false)
    }
  }

  const refreshMembers = async () => {
    if (!manageBook) return
    const m = await bookApi.listMembers(manageBook.id)
    setMembers(m)
  }

  const refreshShareCodes = async () => {
    if (!manageBook) return
    const codes = await bookApi.listShareCodes(manageBook.id)
    setShareCodes(codes)
  }

  const handleAddMember = async () => {
    if (!manageBook) return
    setAddError('')
    try {
      await bookApi.addMember(manageBook.id, addEmail.trim())
      setAddEmail('')
      await refreshMembers()
      await fetchBooks()
    } catch (e: any) {
      setAddError(e.message || '添加失败')
    }
  }

  const handleRemoveMember = async (member: BookMember) => {
    if (!manageBook) return
    try {
      await bookApi.removeMember(manageBook.id, member.id)
      await refreshMembers()
      await fetchBooks()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleToggleMemberRole = async (member: BookMember) => {
    if (!manageBook) return
    try {
      const newRole = member.role === 'admin' ? 'member' : 'admin'
      await bookApi.updateMemberRole(manageBook.id, member.id, newRole)
      await refreshMembers()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleGenerateCode = async () => {
    if (!manageBook) return
    try {
      await bookApi.generateShareCode(manageBook.id, expireHours)
      setExpireHours(undefined)
      await refreshShareCodes()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleDelete = async () => {
    if (!showDelete) return
    if (deleteInput !== showDelete.name) {
      return
    }
    try {
      await bookApi.deleteBook(showDelete.id)
      removeBook(showDelete.id)
      setShowDelete(null)
      setDeleteInput('')
    } catch (e: any) {
      alert(e.message)
    }
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      // 简单反馈
    }).catch(() => {})
  }

  if (loading && books.length === 0) {
    return <div style={{ color: '#64748b', textAlign: 'center', padding: 48 }}>加载中...</div>
  }

  return (
    <div>
      {/* ===== Header ===== */}
      <div style={st.header}>
        <h1 style={st.title}>账本管理</h1>
        <div style={st.headerBtns}>
          <button
            style={st.btnSecondary}
            onClick={() => { setShowJoin(true); setJoinStep('input'); setJoinCode(''); setJoinError(''); setJoinLookup(null) }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#f97316' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155' }}
          >
            <Share size={16} /> 加入账本
          </button>
          <button
            style={st.btnPrimary}
            onClick={() => { setShowCreate(true); setCreateName(''); setCreateError('') }}
          >
            <Plus size={16} /> 创建账本
          </button>
        </div>
      </div>

      {error && <div style={st.errorText}>{error}</div>}

      {/* ===== 账本列表 ===== */}
      {books.length === 0 ? (
        <div style={st.emptyState}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>暂无账本</p>
          <p style={{ fontSize: 13 }}>创建你的第一个账本，或通过分享码加入他人的账本</p>
        </div>
      ) : (
        <div style={st.grid}>
          {books.map((book) => (
            <div
              key={book.id}
              style={st.card}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#475569' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155' }}
            >
              <div style={st.cardTop}>
                <div>
                  <div style={st.cardName}>{book.name}</div>
                  <span style={st.badge(book.role)}>{roleLabels[book.role] || book.role}</span>
                </div>
                <div style={st.cardActions}>
                  {/* 管理（归属人） */}
                  {book.role === 'owner' && (
                    <button
                      style={st.iconBtn(false)}
                      title="管理账本"
                      onClick={() => openManage(book)}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.color = '#94a3b8' }}
                    >
                      <Settings size={16} />
                    </button>
                  )}
                  {/* 删除（归属人） */}
                  {book.role === 'owner' && (
                    <button
                      style={st.iconBtn(true)}
                      title="删除账本"
                      onClick={() => { setShowDelete(book); setDeleteInput('') }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444' }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  {/* 退出（非归属人） */}
                  {book.role !== 'owner' && (
                    <button
                      style={st.iconBtn(true)}
                      title="退出账本"
                      onClick={async () => {
                        if (!confirm('确定退出该账本吗？')) return
                        try {
                          // 找到自己的 member 并移除
                          const m = await bookApi.listMembers(book.id)
                          const self = m.find((m) => m.userId === currentUser?.id)
                          if (self) {
                            await bookApi.removeMember(book.id, self.id)
                            await fetchBooks()
                          }
                        } catch (e: any) { alert(e.message) }
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444' }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155' }}
                    >
                      <LogOut size={16} />
                    </button>
                  )}
                </div>
              </div>
              <div style={st.cardInfo}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={14} /> {book.memberCount} 人
                </span>
                <span>{new Date(book.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========== 创建账本弹窗 ========== */}
      {showCreate && (
        <Modal title="创建账本" onClose={() => setShowCreate(false)}>
          <input
            style={st.input}
            placeholder="输入账本名称"
            value={createName}
            onChange={(e) => { setCreateName(e.target.value); setCreateError('') }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#f97316' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#334155' }}
            autoFocus
          />
          {createError && <div style={st.errorText}>{createError}</div>}
          <div style={st.modalActions}>
            <button style={st.cancelBtn} onClick={() => setShowCreate(false)}>取消</button>
            <button style={st.submitBtn} onClick={handleCreate}>创建</button>
          </div>
        </Modal>
      )}

      {/* ========== 加入账本弹窗 ========== */}
      {showJoin && (
        <Modal title="加入账本" onClose={() => setShowJoin(false)}>
          {joinStep === 'input' ? (
            <>
              <input
                style={{ ...st.input, textTransform: 'uppercase', letterSpacing: 4, textAlign: 'center' } as React.CSSProperties}
                placeholder="输入8位分享码"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError('') }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#f97316' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#334155' }}
                autoFocus
                maxLength={8}
              />
              {joinError && <div style={st.errorText}>{joinError}</div>}
              <div style={st.tipText}>由账本归属人在管理面板生成分享码</div>
              <div style={st.modalActions}>
                <button style={st.cancelBtn} onClick={() => setShowJoin(false)}>取消</button>
                <button style={st.submitBtn} onClick={handleLookup} disabled={joinCode.length < 1}>验证</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <p style={{ fontSize: 16, color: '#e2e8f0', marginBottom: 8 }}>
                  确认加入 <strong style={{ color: '#f97316' }}>{joinLookup?.bookName}</strong>？
                </p>
                {joinLookup?.expiresAt && (
                  <p style={{ fontSize: 13, color: '#64748b' }}>
                    分享码有效期至 {new Date(joinLookup.expiresAt).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>
              {joinError && <div style={st.errorText}>{joinError}</div>}
              <div style={st.modalActions}>
                <button style={st.cancelBtn} onClick={() => { setJoinStep('input'); setJoinError('') }}>返回</button>
                <button style={st.submitBtn} onClick={handleJoin}>确认加入</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ========== 管理面板弹窗 ========== */}
      {manageBook && (
        <Modal title={manageBook.name} onClose={() => setManageBook(null)} wide>
          {/* Tabs */}
          <div style={st.tabs}>
            <button style={st.tab(manageTab === 'members')} onClick={() => setManageTab('members')}>
              成员管理
            </button>
            {manageBook.role === 'owner' && (
              <button style={st.tab(manageTab === 'share')} onClick={() => setManageTab('share')}>
                分享码
              </button>
            )}
          </div>

          {manageLoading ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>加载中...</div>
          ) : (
            <>
              {/* 成员管理 */}
              {manageTab === 'members' && (
                <div>
                  {manageBook.role === 'owner' && (
                    <>
                      <div style={st.addMemberForm}>
                        <input
                          style={{ ...st.input, flex: 1 }}
                          placeholder="输入用户邮箱添加成员"
                          value={addEmail}
                          onChange={(e) => { setAddEmail(e.target.value); setAddError('') }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = '#f97316' }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = '#334155' }}
                        />
                        <button style={st.submitBtn} onClick={handleAddMember}>添加</button>
                      </div>
                      {addError && <div style={st.errorText}>{addError}</div>}
                    </>
                  )}
                  <div style={{ marginTop: 12 }}>
                    {members.map((m) => (
                      <div key={m.id} style={st.memberRow}>
                        <div style={st.memberInfo}>
                          <span style={st.memberName}>
                            {m.user.name || m.user.email}
                            {m.userId === manageBook.ownerId && (
                              <span style={{ ...st.badge('owner'), marginLeft: 8, fontSize: 10 }}>归属人</span>
                            )}
                          </span>
                          <span style={st.memberEmail}>{m.user.email}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {manageBook.role === 'owner' && m.userId !== manageBook.ownerId && (
                            <>
                              <button
                                style={st.btnSmall(false)}
                                onClick={() => handleToggleMemberRole(m)}
                                title={m.role === 'admin' ? '降为成员' : '提升为管理员'}
                              >
                                {m.role === 'admin' ? <ShieldOff size={14} /> : <Shield size={14} />}
                                <span style={{ marginLeft: 4 }}>{m.role === 'admin' ? '降为成员' : '提升管理'}</span>
                              </button>
                              <button
                                style={st.btnSmall(true)}
                                onClick={() => { if (confirm(`确定移除 ${m.user.name || m.user.email}？`)) handleRemoveMember(m) }}
                              >
                                移除
                              </button>
                            </>
                          )}
                          {manageBook.role !== 'owner' && currentUser?.id === m.userId && (
                            <button
                              style={st.btnSmall(true)}
                              onClick={() => { if (confirm('确定退出该账本？')) handleRemoveMember(m) }}
                            >
                              <LogOut size={14} /> 退出
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: 16 }}>暂无成员</div>}
                  </div>
                </div>
              )}

              {/* 分享码 */}
              {manageTab === 'share' && (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>有效期（小时，留空永久）</label>
                      <input
                        type="number" min={1} max={720}
                        style={st.input}
                        placeholder="留空 = 永久有效"
                        value={expireHours ?? ''}
                        onChange={(e) => setExpireHours(e.target.value ? parseInt(e.target.value) : undefined)}
                        onFocus={(e) => { e.currentTarget.style.borderColor = '#f97316' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = '#334155' }}
                      />
                    </div>
                    <button style={{ ...st.submitBtn, height: 42 }} onClick={handleGenerateCode}>
                      生成
                    </button>
                  </div>

                  {shareCodes.map((sc) => (
                    <div key={sc.id} style={st.codeRow}>
                      <div>
                        <div style={st.codeText}>{sc.code}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                          {sc.expiresAt ? `有效期至 ${new Date(sc.expiresAt).toLocaleString('zh-CN')}` : '永久有效'}
                          {sc.isExpired && <span style={{ color: '#ef4444', marginLeft: 8 }}>已过期</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          style={st.btnSmall(false)}
                          onClick={() => copyCode(sc.code)}
                          title="复制分享码"
                        >
                          <Copy size={14} /> 复制
                        </button>
                        <button
                          style={st.btnSmall(true)}
                          onClick={async () => {
                            if (!confirm('确定删除该分享码？')) return
                            try {
                              await bookApi.deleteShareCode(manageBook.id, sc.id)
                              await refreshShareCodes()
                            } catch (e: any) { alert(e.message) }
                          }}
                          title="删除分享码"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {shareCodes.length === 0 && (
                    <div style={{ color: '#64748b', textAlign: 'center', padding: 16 }}>暂无分享码</div>
                  )}
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {/* ========== 删除确认弹窗 ========== */}
      {showDelete && (
        <Modal title="删除账本" onClose={() => setShowDelete(null)}>
          <p style={{ fontSize: 14, color: '#e2e8f0', marginBottom: 12 }}>
            确定要删除 <strong style={{ color: '#ef4444' }}>{showDelete.name}</strong> 吗？所有记录将被永久删除，此操作不可撤销。
          </p>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
            请输入账本名称 <strong>{showDelete.name}</strong> 确认删除
          </p>
          <input
            style={st.input}
            placeholder="输入账本名称确认"
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#f97316' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#334155' }}
          />
          <div style={st.modalActions}>
            <button style={st.cancelBtn} onClick={() => setShowDelete(null)}>取消</button>
            <button
              style={{
                ...st.submitBtn,
                background: deleteInput === showDelete.name ? '#ef4444' : '#4b5563',
                cursor: deleteInput === showDelete.name ? 'pointer' : 'not-allowed',
                opacity: deleteInput === showDelete.name ? 1 : 0.5,
              }}
              onClick={handleDelete}
              disabled={deleteInput !== showDelete.name}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
