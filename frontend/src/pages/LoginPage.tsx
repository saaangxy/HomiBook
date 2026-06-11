import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Book, Eye, EyeOff, Palette } from 'lucide-react'
import { authApi } from '../api/auth'
import { settingsApi } from '../api/settings'
import { useAuthStore } from '../stores/auth'
import { PasswordStrength } from '../components/PasswordStrength'
import { ThemeSelector } from '../components/ThemeSelector'

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: 'hsl(var(--background))',
    fontFamily: 'var(--theme-font)',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  bgOrb1: {
    position: 'absolute' as const,
    top: '-25%',
    left: '-10%',
    width: '500px',
    height: '500px',
    backgroundColor: 'hsl(var(--primary) / 0.08)',
    borderRadius: '50%',
    filter: 'blur(60px)',
    transition: 'background-color 0.5s ease',
  },
  bgOrb2: {
    position: 'absolute' as const,
    bottom: '-20%',
    right: '-10%',
    width: '600px',
    height: '600px',
    backgroundColor: 'hsl(var(--primary) / 0.06)',
    borderRadius: '50%',
    filter: 'blur(60px)',
    transition: 'background-color 0.5s ease',
  },
  bgAccent: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '800px',
    height: '400px',
    background: 'radial-gradient(ellipse, hsl(var(--accent) / 0.04) 0%, transparent 70%)',
    pointerEvents: 'none' as const,
    transition: 'background 0.5s ease',
  },
  header: {
    position: 'absolute' as const,
    top: '6%',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    zIndex: 10,
  },
  logoContainer: {
    width: '56px',
    height: '56px',
    backgroundColor: 'hsl(var(--primary))',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 32px hsl(var(--primary) / 0.25)',
  },
  headerTitle: {
    fontSize: '38px',
    fontWeight: 800,
    color: 'hsl(var(--primary))',
    margin: 0,
    letterSpacing: '-1px',
  },
  themeBtn: {
    position: 'absolute' as const,
    top: '6%',
    right: '6%',
    zIndex: 10,
  },
  card: {
    position: 'relative' as const,
    width: '900px',
    height: '560px',
    borderRadius: '28px',
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px hsl(var(--foreground) / 0.15)',
    border: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--card))',
    transition: 'background-color 0.4s ease, border-color 0.4s ease',
  },
  formContainer: {
    position: 'absolute' as const,
    top: 0,
    width: '50%',
    height: '100%',
    background: 'hsl(var(--card))',
    transition: 'all 0.6s ease-in-out',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center',
    padding: '0 60px',
  },
  signUpContainer: {
    left: 0,
    zIndex: 2,
  },
  signInContainer: {
    right: 0,
    zIndex: 1,
  },
  formTitle: {
    fontSize: '28px',
    marginBottom: '28px',
    color: 'hsl(var(--foreground))',
    fontWeight: 700,
    letterSpacing: '-0.5px',
  },
  formSubtitle: {
    fontSize: '14px',
    color: 'hsl(var(--muted-foreground))',
    marginBottom: '32px',
    marginTop: '-20px',
  },
  input: {
    width: '100%',
    margin: '12px 0',
    padding: '16px 18px',
    backgroundColor: 'hsl(var(--muted))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '14px',
    fontSize: '15px',
    color: 'hsl(var(--foreground))',
    outline: 'none',
    transition: 'all 0.3s ease',
    fontFamily: 'var(--theme-font)',
  },
  inputFocus: {
    borderColor: 'hsl(var(--primary))',
    backgroundColor: 'hsl(var(--card))',
    boxShadow: '0 0 0 3px hsl(var(--primary) / 0.15)',
  },
  forgetPassword: {
    display: 'block',
    textDecoration: 'none',
    color: 'hsl(var(--muted-foreground))',
    fontSize: '13px',
    marginTop: '16px',
    marginBottom: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'center' as const,
  },
  forgetPasswordHover: {
    color: 'hsl(var(--primary))',
  },
  buttonWrapper: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  button: {
    backgroundColor: 'hsl(var(--primary))',
    padding: '14px 48px',
    border: 'none',
    borderRadius: '14px',
    color: 'hsl(var(--primary-foreground))',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    fontFamily: 'var(--theme-font)',
  },
  buttonHover: {
    backgroundColor: 'hsl(var(--primary))',
    filter: 'brightness(1.1)',
  },
  overlayContainer: {
    position: 'absolute' as const,
    top: 0,
    width: '50%',
    height: '100%',
    zIndex: 100,
    right: 0,
    overflow: 'hidden',
    transition: 'all 0.6s ease-in-out',
  },
  overlay: {
    position: 'absolute' as const,
    width: '200%',
    height: '100%',
    left: '-100%',
    backgroundColor: 'hsl(var(--primary))',
    transition: 'all 0.6s ease-in-out',
  },
  overlayPanel: {
    position: 'absolute' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center',
    width: '50%',
    height: '100%',
    color: 'white',
    padding: '0 50px',
    textAlign: 'center' as const,
  },
  overlayLeft: {
    left: 0,
  },
  overlayRight: {
    right: 0,
  },
  overlayTitle: {
    fontSize: '26px',
    marginBottom: '14px',
    fontWeight: 700,
  },
  overlayText: {
    fontSize: '14px',
    margin: '14px 0 28px 0',
    lineHeight: 1.6,
    opacity: 0.9,
  },
  overlayButton: {
    backgroundColor: 'transparent',
    border: '2px solid rgba(255, 255, 255, 0.75)',
    padding: '12px 36px',
    borderRadius: '28px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '0.5px',
    transition: 'all 0.3s ease',
    fontFamily: 'var(--theme-font)',
  },
  overlayButtonHover: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderColor: 'rgba(255, 255, 255, 1)',
  },
  errorText: {
    color: 'hsl(var(--destructive))',
    fontSize: '13px',
    marginTop: '12px',
    textAlign: 'center' as const,
    backgroundColor: 'hsl(var(--destructive) / 0.1)',
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid hsl(var(--destructive) / 0.2)',
  },
}

export function LoginPage() {
  const [isActive, setIsActive] = useState(false)
  const [loginAccount, setLoginAccount] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registerUsername, setRegisterUsername] = useState('')
  const [registerNickname, setRegisterNickname] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showLoginPass, setShowLoginPass] = useState(false)
  const [showRegPass, setShowRegPass] = useState(false)
  const [hoverStates, setHoverStates] = useState<Record<string, boolean>>({})
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [themePopover, setThemePopover] = useState(false)
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  useEffect(() => {
    settingsApi.getPublicConfig()
      .then((cfg) => setRegistrationOpen(cfg.registrationOpen))
      .catch(() => setRegistrationOpen(true))
  }, [])

  useEffect(() => {
    setError('')
  }, [isActive])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const res = await authApi.login(loginAccount, loginPassword)
      setAuth(res.token, res.user)
      navigate('/')
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await authApi.register(registerUsername, registerEmail, registerPassword, registerNickname || undefined)
      setIsActive(false)
      setError('')
    } catch (err: any) {
      setError(err.message || '注册失败')
    } finally {
      setIsLoading(false)
    }
  }

  const getInputStyle = (fieldName: string) => {
    return {
      ...styles.input,
      ...(focusedInput === fieldName ? styles.inputFocus : {}),
    }
  }

  return (
    <div style={styles.container}>
      {/* 背景装饰 */}
      <div style={styles.bgOrb1} className="login-bg-orb" />
      <div style={styles.bgOrb2} className="login-bg-orb" />
      <div style={styles.bgAccent} className="login-bg-accent" />

      {/* 主题切换按钮 */}
      <div style={styles.themeBtn}>
        <div className="relative">
          <button
            onClick={() => setThemePopover(!themePopover)}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-border bg-card hover:bg-accent transition-colors"
            title="切换主题"
          >
            <Palette size={18} className="text-muted-foreground" />
          </button>
          {themePopover && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setThemePopover(false)} />
              <div className="absolute right-0 top-12 z-30 w-72 p-4 rounded-2xl border border-border bg-card shadow-2xl">
                <h3 className="text-sm font-semibold text-foreground mb-3">选择主题</h3>
                <ThemeSelector compact />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Header with logo */}
      <div style={styles.header}>
        <div style={styles.logoContainer}>
          <Book size={28} color="#fff" />
        </div>
        <h2 style={styles.headerTitle}>Homibook</h2>
      </div>

      {/* 注册关闭时：仅显示居中登录表单 */}
      {!registrationOpen ? (
        <div
          className="login-card"
          style={{
            position: 'relative' as const,
            width: '420px',
            borderRadius: '28px',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px hsl(var(--foreground) / 0.15)',
            border: '1px solid hsl(var(--border))',
            backgroundColor: 'hsl(var(--card))',
            padding: '48px 40px',
          }}
        >
          <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 style={styles.formTitle}>登录</h2>
            <p style={styles.formSubtitle}>登录以继续管理你的账本</p>
            <input
              type="text"
              placeholder="账号或邮箱"
              value={loginAccount}
              onChange={(e) => setLoginAccount(e.target.value)}
              style={getInputStyle('loginEmail')}
              onFocus={() => setFocusedInput('loginEmail')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showLoginPass ? 'text' : 'password'}
                placeholder="密码"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{ ...getInputStyle('loginPass'), paddingRight: '44px' }}
                onFocus={() => setFocusedInput('loginPass')}
                onBlur={() => setFocusedInput(null)}
                required
              />
              <button
                type="button"
                onClick={() => setShowLoginPass(!showLoginPass)}
                style={{
                  position: 'absolute',
                  right: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'hsl(var(--muted-foreground))',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showLoginPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <a
              href="#"
              style={{
                ...styles.forgetPassword,
                ...(hoverStates.forgetPass ? styles.forgetPasswordHover : {}),
              }}
              onMouseEnter={() => setHoverStates({ ...hoverStates, forgetPass: true })}
              onMouseLeave={() => setHoverStates({ ...hoverStates, forgetPass: false })}
            >
              忘记密码?
            </a>
            {error && <div style={styles.errorText}>{error}</div>}
            <div style={styles.buttonWrapper}>
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...(hoverStates.signIn ? styles.buttonHover : {}),
                  opacity: isLoading ? 0.7 : 1,
                }}
                onMouseEnter={() => setHoverStates({ ...hoverStates, signIn: true })}
                onMouseLeave={() => setHoverStates({ ...hoverStates, signIn: false })}
                disabled={isLoading}
              >
                {isLoading ? '登录中...' : '登录'}
              </button>
            </div>
          </form>
        </div>
      ) : (
      <div style={styles.card} className="login-card">
        {/* 登录表单 */}
        <div
          style={{
            ...styles.formContainer,
            ...styles.signUpContainer,
            zIndex: isActive ? 2 : 5,
          }}
        >
          <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 style={styles.formTitle}>欢迎回来</h2>
            <p style={styles.formSubtitle}>登录以继续管理你的账本</p>
            <input
              type="text"
              placeholder="账号或邮箱"
              value={loginAccount}
              onChange={(e) => setLoginAccount(e.target.value)}
              style={getInputStyle('loginEmail')}
              onFocus={() => setFocusedInput('loginEmail')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showLoginPass ? 'text' : 'password'}
                placeholder="密码"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{ ...getInputStyle('loginPass'), paddingRight: '44px' }}
                onFocus={() => setFocusedInput('loginPass')}
                onBlur={() => setFocusedInput(null)}
                required
              />
              <button
                type="button"
                onClick={() => setShowLoginPass(!showLoginPass)}
                style={{
                  position: 'absolute',
                  right: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'hsl(var(--muted-foreground))',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showLoginPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <a
              href="#"
              style={{
                ...styles.forgetPassword,
                ...(hoverStates.forgetPass ? styles.forgetPasswordHover : {}),
              }}
              onMouseEnter={() => setHoverStates({ ...hoverStates, forgetPass: true })}
              onMouseLeave={() => setHoverStates({ ...hoverStates, forgetPass: false })}
            >
              忘记密码?
            </a>
            {error && <div style={styles.errorText}>{error}</div>}
            <div style={styles.buttonWrapper}>
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...(hoverStates.signIn ? styles.buttonHover : {}),
                  opacity: isLoading ? 0.7 : 1,
                }}
                onMouseEnter={() => setHoverStates({ ...hoverStates, signIn: true })}
                onMouseLeave={() => setHoverStates({ ...hoverStates, signIn: false })}
                disabled={isLoading}
              >
                {isLoading ? '登录中...' : '登录'}
              </button>
            </div>
          </form>
        </div>

        {/* 注册表单 */}
        <div
          style={{
            ...styles.formContainer,
            ...styles.signInContainer,
          }}
        >
          <form onSubmit={handleRegister} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 style={styles.formTitle}>创建账号</h2>
            <p style={styles.formSubtitle}>开始管理你的家庭财务</p>
            <input
              type="text"
              placeholder="账号"
              value={registerUsername}
              onChange={(e) => setRegisterUsername(e.target.value)}
              style={getInputStyle('regUsername')}
              onFocus={() => setFocusedInput('regUsername')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            <input
              type="text"
              placeholder="昵称（可选）"
              value={registerNickname}
              onChange={(e) => setRegisterNickname(e.target.value)}
              style={getInputStyle('regNickname')}
              onFocus={() => setFocusedInput('regNickname')}
              onBlur={() => setFocusedInput(null)}
            />
            <input
              type="email"
              placeholder="邮箱地址"
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              style={getInputStyle('regEmail')}
              onFocus={() => setFocusedInput('regEmail')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showRegPass ? 'text' : 'password'}
                placeholder="密码"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                style={{ ...getInputStyle('regPass'), paddingRight: '44px' }}
                onFocus={() => setFocusedInput('regPass')}
                onBlur={() => setFocusedInput(null)}
                required
              />
              <button
                type="button"
                onClick={() => setShowRegPass(!showRegPass)}
                style={{
                  position: 'absolute',
                  right: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'hsl(var(--muted-foreground))',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showRegPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <div style={{ width: '100%' }}>
              <PasswordStrength password={registerPassword} />
            </div>
            {error && <div style={styles.errorText}>{error}</div>}
            <div style={styles.buttonWrapper}>
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...(hoverStates.signUp ? styles.buttonHover : {}),
                  opacity: isLoading ? 0.7 : 1,
                }}
                onMouseEnter={() => setHoverStates({ ...hoverStates, signUp: true })}
                onMouseLeave={() => setHoverStates({ ...hoverStates, signUp: false })}
                disabled={isLoading}
              >
                {isLoading ? '创建中...' : '立即创建'}
              </button>
            </div>
          </form>
        </div>

        {/* Overlay 滑动面板 */}
        <div
          className="login-overlay-container"
          style={{
            ...styles.overlayContainer,
            transform: isActive ? 'translateX(-100%)' : 'translateX(0)',
          }}
        >
          <div
            className="login-overlay"
            style={{
              ...styles.overlay,
              transform: isActive ? 'translateX(50%)' : 'translateX(0)',
            }}
          >
            <div className="login-overlay-panel" style={{ ...styles.overlayPanel, ...styles.overlayLeft }}>
              <h2 style={styles.overlayTitle}>已有账户?</h2>
              <p style={styles.overlayText}>登录后继续管理你的家庭财务</p>
              <button
                style={{
                  ...styles.overlayButton,
                  ...(hoverStates.overlaySignIn ? styles.overlayButtonHover : {}),
                }}
                onMouseEnter={() => setHoverStates({ ...hoverStates, overlaySignIn: true })}
                onMouseLeave={() => setHoverStates({ ...hoverStates, overlaySignIn: false })}
                onClick={() => setIsActive(false)}
              >
                登录
              </button>
            </div>
            <div className="login-overlay-panel" style={{ ...styles.overlayPanel, ...styles.overlayRight }}>
              <h2 style={styles.overlayTitle}>还没有账户?</h2>
              <p style={styles.overlayText}>立即注册,和家人一起管理财务</p>
              <button
                style={{
                  ...styles.overlayButton,
                  ...(hoverStates.overlaySignUp ? styles.overlayButtonHover : {}),
                }}
                onMouseEnter={() => setHoverStates({ ...hoverStates, overlaySignUp: true })}
                onMouseLeave={() => setHoverStates({ ...hoverStates, overlaySignUp: false })}
                onClick={() => setIsActive(true)}
              >
                创建账户
              </button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}

export default LoginPage
