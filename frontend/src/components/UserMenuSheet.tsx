import { useState, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { useThemeContext } from './ThemeProvider'
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
import { User, Lock, FileText, Check } from 'lucide-react'
import { PasswordStrength } from './PasswordStrength'
import { cn } from '@/lib/utils'

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
  const { theme: currentTheme, setTheme, themeList } = useThemeContext()
  const [name, setName] = useState(user?.name || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)

  const handleSaveName = async () => {
    if (!name.trim()) {
      setIsError(true)
      setMsg('名称不能为空')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const updated = await authApi.updateProfile(name.trim())
      useAuthStore.getState().updateUser(updated)
      setIsError(false)
      setMsg('保存成功')
    } catch (e: any) {
      setIsError(true)
      setMsg(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setName(user?.name || '')
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
          <DialogDescription>修改您的名称和主题</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-xs text-muted-foreground">邮箱</Label>
            <p className="text-sm mt-0.5">{user?.email}</p>
          </div>
          <div>
            <Label htmlFor="profile-name">名称</Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入名称"
                maxLength={30}
                className="flex-1"
              />
              <Button
                onClick={handleSaveName}
                disabled={saving}
                className="rounded-[10px] bg-primary hover:bg-primary/90"
              >
                {saving ? '...' : '保存'}
              </Button>
            </div>
          </div>

          {/* 主题选择 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">主题</Label>
            <div className="grid grid-cols-2 gap-2">
              {themeList.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    'flex items-center gap-2 p-2.5 rounded-[10px] border text-left transition-colors',
                    currentTheme.id === t.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  {/* 颜色预览圆点 */}
                  <div className="flex gap-0.5">
                    <div
                      className="w-3 h-3 rounded-full border border-white/20"
                      style={{ backgroundColor: `hsl(${t.vars['--primary']})` }}
                    />
                    <div
                      className="w-3 h-3 rounded-full border border-white/20"
                      style={{ backgroundColor: `hsl(${t.vars['--background']})` }}
                    />
                  </div>
                  <span className="text-sm flex-1">{t.name}</span>
                  {currentTheme.id === t.id && (
                    <Check size={14} className="text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>
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
      setIsError(false)
      setMsg('密码修改成功')
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
