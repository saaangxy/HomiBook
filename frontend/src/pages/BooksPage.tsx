import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardBody,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from '@heroui/react'
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

  const createModal = useDisclosure()
  const joinModal = useDisclosure()
  const manageModal = useDisclosure()
  const deleteModal = useDisclosure()

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
      createModal.onClose()
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
      joinModal.onClose()
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
    manageModal.onOpen()
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
    catch (e: any) { alert(e.message) }
  }

  const handleToggleMemberRole = async (member: BookMember) => {
    if (!manageBook) return
    try {
      const newRole = member.role === 'admin' ? 'member' : 'admin'
      await bookApi.updateMemberRole(manageBook.id, member.id, newRole)
      await refreshMembers()
    } catch (e: any) { alert(e.message) }
  }

  const handleGenerateCode = async () => {
    if (!manageBook) return
    try {
      const hours = expireHours ? parseInt(expireHours) : undefined
      await bookApi.generateShareCode(manageBook.id, hours)
      setExpireHours('')
      await refreshShareCodes()
    } catch (e: any) { alert(e.message) }
  }

  const handleDelete = async () => {
    if (!deleteBook || deleteInput !== deleteBook.name) return
    setDeleting(true)
    try {
      await bookApi.deleteBook(deleteBook.id)
      removeBook(deleteBook.id)
      deleteModal.onClose()
      setDeleteBook(null)
      setDeleteInput('')
    } catch (e: any) { alert(e.message) }
    finally { setDeleting(false) }
  }

  const copyCode = (code: string) => { navigator.clipboard.writeText(code).catch(() => {}) }

  const inputClass = 'w-full px-3.5 py-2.5 bg-[#0f172a] border border-[#334155] rounded-lg text-[#e2e8f0] text-sm outline-none focus:border-[#f97316] transition-colors'

  if (loading && books.length === 0) {
    return <div className="text-center py-12 text-sm text-[#64748b]">加载中...</div>
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-[#e2e8f0]">账本管理</h1>
        <div className="flex gap-2.5">
          <button
            className="flex items-center gap-1.5 px-[18px] py-2 rounded-lg border border-[#334155] bg-[#1e293b] text-[#e2e8f0] text-sm font-medium cursor-pointer hover:border-[#f97316] transition-colors"
            style={{ fontFamily: 'inherit' }}
            onClick={() => { setJoinStep('input'); setJoinCode(''); setJoinError(''); setJoinLookup(null); joinModal.onOpen() }}
          >
            <Share size={16} /> 加入账本
          </button>
          <button
            className="flex items-center gap-1.5 px-[18px] py-2 rounded-lg bg-[#f97316] text-white text-sm font-semibold cursor-pointer transition-colors"
            style={{ border: 'none', fontFamily: 'inherit' }}
            onClick={() => { setCreateName(''); setCreateError(''); createModal.onOpen() }}
          >
            <Plus size={16} /> 创建账本
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[13px] text-[#fca5a5] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-[10px] px-4 py-3 mb-6">
          {error}
        </div>
      )}

      {/* 账本列表 */}
      {books.length === 0 ? (
        <Card className="bg-[#1e293b] border border-[#334155] rounded-2xl">
          <CardBody className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <p className="text-base text-[#e2e8f0]">暂无账本</p>
            <p className="text-[13px] text-[#64748b]">创建你的第一个账本，或通过分享码加入他人的账本</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {books.map((book) => (
            <Card key={book.id} className="bg-[#1e293b] border border-[#334155] rounded-xl hover:border-[#475569] transition-colors">
              <CardBody className="flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[17px] font-semibold text-[#e2e8f0]">{book.name}</div>
                    <span className={`inline-block text-[11px] px-2.5 py-0.5 rounded-full font-semibold mt-1 ${
                      book.role === 'owner' ? 'bg-[#f97316]/15 text-[#f97316]' : 'bg-[#64748b]/15 text-[#94a3b8]'
                    }`}>
                      {roleLabels[book.role] || book.role}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {(book.role === 'owner' || book.role === 'admin') && (
                      <button
                        className="w-[34px] h-[34px] flex items-center justify-center rounded-lg border border-[#334155] bg-[#0f172a] text-[#94a3b8] cursor-pointer hover:border-[#f97316] hover:text-[#f97316] transition-colors"
                        style={{ fontFamily: 'inherit' }}
                        title="管理账本"
                        onClick={() => openManage(book)}
                      >
                        <Settings size={16} />
                      </button>
                    )}
                    {book.role === 'owner' && (
                      <button
                        className="w-[34px] h-[34px] flex items-center justify-center rounded-lg border border-[#334155] bg-[#0f172a] text-[#ef4444] cursor-pointer hover:border-[#ef4444] transition-colors"
                        style={{ fontFamily: 'inherit' }}
                        title="删除账本"
                        onClick={() => { setDeleteBook(book); setDeleteInput(''); deleteModal.onOpen() }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                    {book.role !== 'owner' && (
                      <button
                        className="w-[34px] h-[34px] flex items-center justify-center rounded-lg border border-[#334155] bg-[#0f172a] text-[#ef4444] cursor-pointer hover:border-[#ef4444] transition-colors"
                        style={{ fontFamily: 'inherit' }}
                        title="退出账本"
                        onClick={async () => {
                          if (!confirm('确定退出该账本吗？')) return
                          try {
                            const m = await bookApi.listMembers(book.id)
                            const self = m.find((m) => m.userId === currentUser?.id)
                            if (self) { await bookApi.removeMember(book.id, self.id); await fetchBooks() }
                          } catch (e: any) { alert(e.message) }
                        }}
                      >
                        <LogOut size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[13px] text-[#94a3b8]">
                  <span className="flex items-center gap-1"><Users size={14} /> {book.memberCount} 人</span>
                  <span>{new Date(book.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* 创建账本弹窗 */}
      <Modal isOpen={createModal.isOpen} onClose={createModal.onClose} size="md" classNames={{ base: 'bg-[#1e293b] border border-[#334155] rounded-2xl', header: 'text-lg font-bold text-[#e2e8f0]' }}>
        <ModalContent>
          <ModalHeader>创建账本</ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            <input
              className={inputClass}
              placeholder="输入账本名称"
              value={createName}
              onChange={(e) => { setCreateName(e.target.value); setCreateError('') }}
              autoFocus
            />
            {createError && <div className="text-[13px] text-[#fca5a5]">{createError}</div>}
          </ModalBody>
          <ModalFooter>
            <button className="px-5 py-2 rounded-lg border border-[#334155] bg-transparent text-[#94a3b8] cursor-pointer text-sm" style={{ fontFamily: 'inherit' }} onClick={createModal.onClose}>取消</button>
            <button className="px-5 py-2 rounded-lg bg-[#f97316] text-white cursor-pointer text-sm font-semibold disabled:opacity-50" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleCreate} disabled={creating}>
              {creating ? '创建中...' : '创建'}
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 加入账本弹窗 */}
      <Modal isOpen={joinModal.isOpen} onClose={() => { joinModal.onClose(); setJoinStep('input'); setJoinError('') }} size="md" classNames={{ base: 'bg-[#1e293b] border border-[#334155] rounded-2xl', header: 'text-lg font-bold text-[#e2e8f0]' }}>
        <ModalContent>
          <ModalHeader>加入账本</ModalHeader>
          {joinStep === 'input' ? (
            <>
              <ModalBody className="flex flex-col gap-4">
                <input
                  className={inputClass}
                  style={{ textTransform: 'uppercase', letterSpacing: 4, textAlign: 'center' }}
                  placeholder="输入8位分享码"
                  value={joinCode}
                  onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError('') }}
                  autoFocus
                  maxLength={8}
                />
                {joinError && <div className="text-[13px] text-[#fca5a5]">{joinError}</div>}
                <p className="text-xs text-[#64748b]">由账本归属人在管理面板生成分享码</p>
              </ModalBody>
              <ModalFooter>
                <button className="px-5 py-2 rounded-lg border border-[#334155] bg-transparent text-[#94a3b8] cursor-pointer text-sm" style={{ fontFamily: 'inherit' }} onClick={joinModal.onClose}>取消</button>
                <button className="px-5 py-2 rounded-lg bg-[#f97316] text-white cursor-pointer text-sm font-semibold disabled:opacity-50" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleLookup} disabled={joinCode.length < 1}>
                  验证
                </button>
              </ModalFooter>
            </>
          ) : (
            <>
              <ModalBody className="flex flex-col gap-4 text-center">
                <p className="text-base text-[#e2e8f0]">
                  确认加入 <strong className="text-[#f97316]">{joinLookup?.bookName}</strong>？
                </p>
                {joinLookup?.expiresAt && (
                  <p className="text-[13px] text-[#64748b]">分享码有效期至 {new Date(joinLookup.expiresAt).toLocaleString('zh-CN')}</p>
                )}
                {joinError && <div className="text-[13px] text-[#fca5a5]">{joinError}</div>}
              </ModalBody>
              <ModalFooter>
                <button className="px-5 py-2 rounded-lg border border-[#334155] bg-transparent text-[#94a3b8] cursor-pointer text-sm" style={{ fontFamily: 'inherit' }} onClick={() => { setJoinStep('input'); setJoinError('') }}>返回</button>
                <button className="px-5 py-2 rounded-lg bg-[#f97316] text-white cursor-pointer text-sm font-semibold disabled:opacity-50" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleJoin} disabled={joining}>
                  {joining ? '加入中...' : '确认加入'}
                </button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* 管理面板弹窗 */}
      <Modal isOpen={manageModal.isOpen} onClose={() => { manageModal.onClose(); setManageBook(null) }} size="2xl" classNames={{ base: 'bg-[#1e293b] border border-[#334155] rounded-2xl', header: 'text-lg font-bold text-[#e2e8f0]' }}>
        <ModalContent>
          <ModalHeader>{manageBook?.name}</ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            {/* Tabs */}
            <div className="flex border-b border-[#334155] mb-4">
              <button
                className={`px-4 py-2 text-sm font-medium cursor-pointer outline-none border-b-2 transition-colors ${
                  manageTab === 'members' ? 'text-[#f97316] border-[#f97316]' : 'text-[#94a3b8] border-transparent'
                }`}
                style={{ background: 'none', fontFamily: 'inherit' }}
                onClick={() => setManageTab('members')}
              >
                成员管理
              </button>
              {manageBook && (manageBook.role === 'owner' || manageBook.role === 'admin') && (
                <button
                  className={`px-4 py-2 text-sm font-medium cursor-pointer outline-none border-b-2 transition-colors ${
                    manageTab === 'share' ? 'text-[#f97316] border-[#f97316]' : 'text-[#94a3b8] border-transparent'
                  }`}
                  style={{ background: 'none', fontFamily: 'inherit' }}
                  onClick={() => setManageTab('share')}
                >
                  分享码
                </button>
              )}
            </div>

            {manageLoading ? (
              <div className="text-center py-6 text-sm text-[#64748b]">加载中...</div>
            ) : (
              <>
                {/* 成员管理 */}
                {manageTab === 'members' && (
                  <div className="flex flex-col gap-3">
                    {(manageBook?.role === 'owner' || manageBook?.role === 'admin') && (
                      <div className="flex gap-2 mb-2">
                        <input
                          className={`${inputClass} flex-1`}
                          placeholder="输入用户邮箱添加成员"
                          value={addEmail}
                          onChange={(e) => { setAddEmail(e.target.value); setAddError('') }}
                        />
                        <button className="px-5 py-2 rounded-lg bg-[#f97316] text-white cursor-pointer text-sm font-semibold" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleAddMember}>
                          添加
                        </button>
                      </div>
                    )}
                    {addError && <div className="text-[13px] text-[#fca5a5] -mt-1">{addError}</div>}

                    {members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between py-2.5 border-b border-[#1e293b] last:border-0">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-[#e2e8f0]">
                            {m.user.name || m.user.email}
                            {m.userId === manageBook?.ownerId && (
                              <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#f97316]/15 text-[#f97316]">归属人</span>
                            )}
                          </span>
                          <span className="text-xs text-[#64748b]">{m.user.email}</span>
                        </div>
                        <div className="flex gap-1.5 items-center">
                          {manageBook?.role === 'owner' && m.userId !== manageBook.ownerId && (
                            <button
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer border border-[#334155] bg-transparent text-[#94a3b8] hover:bg-[#1e293b] transition-colors"
                              style={{ fontFamily: 'inherit' }}
                              onClick={() => handleToggleMemberRole(m)}
                              title={m.role === 'admin' ? '降为成员' : '提升为管理员'}
                            >
                              {m.role === 'admin' ? <ShieldOff size={14} /> : <Shield size={14} />}
                              <span className="ml-1">{m.role === 'admin' ? '降为成员' : '提升管理'}</span>
                            </button>
                          )}
                          {(manageBook?.role === 'owner' || manageBook?.role === 'admin') && m.userId !== manageBook.ownerId && m.userId !== currentUser?.id && (
                            <button
                              className="px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer border border-[#7f1d1d] bg-[#ef4444]/10 text-[#ef4444] transition-colors"
                              style={{ fontFamily: 'inherit' }}
                              onClick={() => { if (confirm(`确定移除 ${m.user.name || m.user.email}？`)) handleRemoveMember(m) }}
                            >
                              移除
                            </button>
                          )}
                          {manageBook?.role !== 'owner' && currentUser?.id === m.userId && (
                            <button
                              className="px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer border border-[#7f1d1d] bg-[#ef4444]/10 text-[#ef4444] transition-colors"
                              style={{ fontFamily: 'inherit' }}
                              onClick={() => { if (confirm('确定退出该账本？')) handleRemoveMember(m) }}
                            >
                              <LogOut size={14} className="mr-1" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && (
                      <div className="text-center py-4 text-sm text-[#64748b]">暂无成员</div>
                    )}
                  </div>
                )}

                {/* 分享码 */}
                {manageTab === 'share' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2 items-end mb-4">
                      <div className="flex-1">
                        <label className="block text-xs text-[#64748b] mb-1">有效期（小时，留空永久）</label>
                        <input
                          type="number" min={1} max={720}
                          className={inputClass}
                          placeholder="留空 = 永久有效"
                          value={expireHours}
                          onChange={(e) => setExpireHours(e.target.value)}
                        />
                      </div>
                      <button className="px-5 h-[42px] rounded-lg bg-[#f97316] text-white cursor-pointer text-sm font-semibold" style={{ border: 'none', fontFamily: 'inherit' }} onClick={handleGenerateCode}>
                        生成
                      </button>
                    </div>

                    {shareCodes.map((sc) => (
                      <div key={sc.id} className="flex items-center justify-between px-3.5 py-2.5 bg-[#0f172a] border border-[#334155] rounded-lg">
                        <div>
                          <div className="text-base font-bold text-[#f97316] tracking-[2px]" style={{ fontFamily: 'monospace' }}>{sc.code}</div>
                          <div className="text-xs text-[#64748b] mt-0.5">
                            {sc.expiresAt ? `有效期至 ${new Date(sc.expiresAt).toLocaleString('zh-CN')}` : '永久有效'}
                            {sc.isExpired && <span className="text-[#ef4444] ml-2">已过期</span>}
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer border border-[#334155] bg-transparent text-[#94a3b8] hover:bg-[#1e293b] transition-colors"
                            style={{ fontFamily: 'inherit' }}
                            onClick={() => copyCode(sc.code)}
                          >
                            <Copy size={14} /> 复制
                          </button>
                          <button
                            className="px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer border border-[#7f1d1d] bg-[#ef4444]/10 text-[#ef4444] transition-colors"
                            style={{ fontFamily: 'inherit' }}
                            onClick={async () => {
                              if (!manageBook) return
                              try { await bookApi.deleteShareCode(manageBook.id, sc.id); await refreshShareCodes() }
                              catch (e: any) { alert(e.message) }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {shareCodes.length === 0 && (
                      <div className="text-center py-4 text-sm text-[#64748b]">暂无分享码</div>
                    )}
                  </div>
                )}
              </>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal isOpen={deleteModal.isOpen} onClose={() => { deleteModal.onClose(); setDeleteBook(null) }} size="md" classNames={{ base: 'bg-[#1e293b] border border-[#334155] rounded-2xl', header: 'text-lg font-bold text-[#e2e8f0]' }}>
        <ModalContent>
          <ModalHeader>删除账本</ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            <p className="text-sm text-[#e2e8f0]">
              确定要删除 <strong className="text-[#ef4444]">{deleteBook?.name}</strong> 吗？所有记录将被永久删除，此操作不可撤销。
            </p>
            <p className="text-[13px] text-[#64748b]">
              请输入账本名称 <strong>{deleteBook?.name}</strong> 确认删除
            </p>
            <input
              className={inputClass}
              placeholder="输入账本名称确认"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <button className="px-5 py-2 rounded-lg border border-[#334155] bg-transparent text-[#94a3b8] cursor-pointer text-sm" style={{ fontFamily: 'inherit' }} onClick={deleteModal.onClose}>取消</button>
            <button
              className="px-5 py-2 rounded-lg text-white cursor-pointer text-sm font-semibold disabled:opacity-50 transition-colors"
              style={{ border: 'none', fontFamily: 'inherit', background: deleteInput === deleteBook?.name ? '#ef4444' : '#4b5563' }}
              onClick={handleDelete}
              disabled={deleteInput !== deleteBook?.name || deleting}
            >
              {deleting ? '删除中...' : '确认删除'}
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
