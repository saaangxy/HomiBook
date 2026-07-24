import { Check, X } from 'lucide-react'

interface PasswordStrengthProps {
  password: string
}

interface CheckItem {
  label: string
  met: boolean
}

function getChecks(password: string): CheckItem[] {
  return [
    { label: '至少 8 位字符', met: password.length >= 8 },
    { label: '包含小写字母', met: /[a-z]/.test(password) },
    { label: '包含大写字母', met: /[A-Z]/.test(password) },
    { label: '包含数字', met: /[0-9]/.test(password) },
  ]
}

function getStrength(password: string): { level: string; color: string; width: string } {
  const met = getChecks(password).filter((c) => c.met).length
  if (met <= 1) return { level: '低', color: '#ef4444', width: '25%' }
  if (met <= 3) return { level: '中', color: '#f59e0b', width: '60%' }
  return { level: '高', color: '#22c55e', width: '100%' }
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  if (!password) return null

  const checks = getChecks(password)
  const strength = getStrength(password)

  return (
    <div className="space-y-1.5">
      {/* 强度条 */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: 'hsl(var(--muted))' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: strength.width, backgroundColor: strength.color }}
          />
        </div>
        <span className="text-xs font-medium" style={{ color: strength.color }}>
          {strength.level}
        </span>
      </div>

      {/* 校验项 */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-1 text-xs">
            {check.met ? (
              <Check size={11} style={{ color: '#22c55e' }} />
            ) : (
              <X size={11} style={{ color: 'hsl(var(--muted-foreground))' }} />
            )}
            <span style={{ color: check.met ? '#22c55e' : 'hsl(var(--muted-foreground))' }}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
