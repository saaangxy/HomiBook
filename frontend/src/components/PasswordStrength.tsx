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
    <div className="mt-2 space-y-2">
      {/* 强度条 */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
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
      <div className="space-y-0.5">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-1.5 text-xs">
            {check.met ? (
              <Check size={12} style={{ color: '#22c55e' }} />
            ) : (
              <X size={12} style={{ color: 'rgba(255,255,255,0.25)' }} />
            )}
            <span style={{ color: check.met ? '#22c55e' : 'rgba(255,255,255,0.35)' }}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
