import { useState, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { User, Lock, FileText } from 'lucide-react'
import { PasswordStrength } from './PasswordStrength'
import { ThemeSelector } from './ThemeSelector'
import { toast } from 'sonner'

interface Props {
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}

function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuthStore()
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)

  const handleSaveNickname = async () => {
    if (!nickname.trim()) {
      setIsError(true)
      setMsg('昵称不能为空')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const updated = await authApi.updateProfile(nickname.trim())
      useAuthStore.getState().updateUser(updated)
      setMsg('')
      toast.success('保存成功')
    } catch (e: any) {
      setIsError(true)
      setMsg(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setNickname(user?.nickname || '')
      setMsg('')
      setIsError(false)
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>个人信息</DialogTitle>
          <DialogDescription>修改您的昵称和个人主题</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-xs text-muted-foreground">邮箱</Label>
            <p className="text-sm mt-0.5">{user?.email}</p>
          </div>
          <div>
            <Label htmlFor="profile-name">昵称</Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                id="profile-name"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="输入昵称"
                maxLength={30}
                className="flex-1"
              />
              <Button
                onClick={handleSaveNickname}
                disabled={saving}
                className="rounded-[10px] bg-primary hover:bg-primary/90"
              >
                {saving ? '...' : '保存'}
              </Button>
            </div>
          </div>

          {/* 个人主题选择 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">个人主题</Label>
            <ThemeSelector compact />
          </div>

          {msg && (
            <p className={`text-xs ${isError ? 'text-red-500' : 'text-green-500'}`}>{msg}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changing, setChanging] = useState(false)
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)

  const passwordValid =
    newPassword.length >= 8 &&
    /[a-z]/.test(newPassword) &&
    /[A-Z]/.test(newPassword) &&
    /[0-9]/.test(newPassword)
  const passwordsMatch = confirmPassword === '' || newPassword === confirmPassword

  const handleChange = async () => {
    if (!currentPassword) {
      setIsError(true)
      setMsg('请输入当前密码')
      return
    }
    if (!passwordValid) {
      setIsError(true)
      setMsg('新密码不满足安全要求')
      return
    }
    if (newPassword !== confirmPassword) {
      setIsError(true)
      setMsg('两次输入的密码不一致')
      return
    }
    setChanging(true)
    setMsg('')
    try {
      await authApi.changePassword(currentPassword, newPassword)
      setMsg('')
      toast.success('密码修改成功')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      setIsError(true)
      setMsg(e.message)
    } finally {
      setChanging(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMsg('')
      setIsError(false)
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>新密码需包含大小写字母和数字</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label htmlFor="current-password">当前密码</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="输入当前密码"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="new-password">新密码</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="输入新密码"
              className="mt-1.5"
            />
            <PasswordStrength password={newPassword} />
          </div>
          <div>
            <Label htmlFor="confirm-password">确认新密码</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              className="mt-1.5"
            />
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-red-500 mt-1">两次输入的密码不一致</p>
            )}
          </div>
          <Button
            onClick={handleChange}
            disabled={changing}
            className="w-full rounded-[10px] bg-primary hover:bg-primary/90"
          >
            {changing ? '修改中...' : '修改密码'}
          </Button>
          {msg && (
            <p className={`text-xs ${isError ? 'text-red-500' : 'text-green-500'}`}>{msg}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function UserMenu({ children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          {children}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-40">
          <DropdownMenuItem onClick={() => setProfileOpen(true)}>
            <User size={16} />
            <span>个人信息</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
            <Lock size={16} />
            <span>修改密码</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open('/docs', '_blank')}>
            <FileText size={16} />
            <span>API 文档</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}
