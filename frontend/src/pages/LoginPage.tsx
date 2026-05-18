import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Book } from 'lucide-react'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/auth'

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0c0c0f 0%, #1a1a2e 50%, #0f172a 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  bgOrb1: {
    position: 'absolute' as const,
    top: '-30%',
    left: '-20%',
    width: '600px',
    height: '600px',
    background: 'radial-gradient(circle, rgba(249, 115, 22, 0.3) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(80px)',
  },
  bgOrb2: {
    position: 'absolute' as const,
    bottom: '-30%',
    right: '-20%',
    width: '800px',
    height: '800px',
    background: 'radial-gradient(circle, rgba(234, 88, 12, 0.25) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(100px)',
  },
  header: {
    position: 'absolute' as const,
    top: '6%',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  logoContainer: {
    width: '56px',
    height: '56px',
    background: 'linear-gradient(135deg, #f97316 0%, #fb923c 50%, #fbbf24 100%)',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 32px rgba(249, 115, 22, 0.35)',
  },
  headerTitle: {
    fontSize: '38px',
    fontWeight: 800,
    background: 'linear-gradient(135deg, #fed7aa 0%, #fbbf24 50%, #f97316 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    margin: 0,
    letterSpacing: '-1px',
  },
  card: {
    position: 'relative' as const,
    width: '900px',
    height: '560px',
    borderRadius: '28px',
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
    border: '1px solid rgba(249, 115, 22, 0.12)',
  },
  formContainer: {
    position: 'absolute' as const,
    top: 0,
    width: '50%',
    height: '100%',
    background: 'rgba(15, 23, 42, 0.75)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(249, 115, 22, 0.1)',
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
    color: '#fef3c7',
    fontWeight: 700,
    letterSpacing: '-0.5px',
  },
  formSubtitle: {
    fontSize: '14px',
    color: 'rgba(254, 243, 199, 0.5)',
    marginBottom: '32px',
    marginTop: '-20px',
  },
  input: {
    width: '100%',
    margin: '12px 0',
    padding: '16px 18px',
    backgroundColor: 'rgba(254, 235, 200, 0.04)',
    border: '1px solid rgba(249, 115, 22, 0.15)',
    borderRadius: '14px',
    fontSize: '15px',
    color: '#fef3c7',
    outline: 'none',
    transition: 'all 0.3s ease',
  },
  inputFocus: {
    borderColor: 'rgba(249, 115, 22, 0.6)',
    backgroundColor: 'rgba(254, 235, 200, 0.08)',
    boxShadow: '0 0 0 4px rgba(249, 115, 22, 0.12)',
  },
  forgetPassword: {
    display: 'block',
    textDecoration: 'none',
    color: 'rgba(254, 243, 199, 0.45)',
    fontSize: '13px',
    marginTop: '16px',
    marginBottom: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'center' as const,
  },
  forgetPasswordHover: {
    color: 'rgba(254, 243, 199, 0.8)',
  },
  buttonWrapper: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  button: {
    background: 'linear-gradient(135deg, #f97316 0%, #fb923c 50%, #fbbf24 100%)',
    padding: '14px 48px',
    border: 'none',
    borderRadius: '14px',
    color: '#1c1917',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    boxShadow: '0 8px 24px rgba(249, 115, 22, 0.4)',
    fontFamily: 'inherit',
  },
  buttonHover: {
    transform: 'translateY(-2px)',
    boxShadow: '0 12px 32px rgba(249, 115, 22, 0.5)',
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
    background: 'linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%)',
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
    fontFamily: 'inherit',
  },
  overlayButtonHover: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'rgba(255, 255, 255, 1)',
    transform: 'scale(1.05)',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: '13px',
    marginTop: '12px',
    textAlign: 'center' as const,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  },
}

export function LoginPage() {
  const [isActive, setIsActive] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hoverStates, setHoverStates] = useState<Record<string, boolean>>({})
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const res = await authApi.login(loginEmail, loginPassword)
      setAuth(res.token, res.user)
      navigate('/')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await authApi.register(registerEmail, registerPassword, registerName || undefined)
      setIsActive(false)
      setError('')
    } catch (err: any) {
      setError(err.message || 'Registration failed')
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
      {/* Background orbs */}
      <div style={styles.bgOrb1} />
      <div style={styles.bgOrb2} />

      {/* Header with logo */}
      <div style={styles.header}>
        <div style={styles.logoContainer}>
          <Book size={28} color="#fff" />
        </div>
        <h2 style={styles.headerTitle}>Homibook</h2>
      </div>

      {/* Card */}
      <div style={styles.card}>
        {/* Sign Up Form */}
        <div
          style={{
            ...styles.formContainer,
            ...styles.signUpContainer,
            zIndex: isActive ? 5 : 2,
          }}
        >
          <form onSubmit={handleRegister} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 style={styles.formTitle}>创建账号</h2>
            <p style={styles.formSubtitle}>开始管理你的家庭财务</p>
            <input
              type="text"
              placeholder="用户名"
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              style={getInputStyle('regName')}
              onFocus={() => setFocusedInput('regName')}
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
            <input
              type="password"
              placeholder="密码"
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              style={getInputStyle('regPass')}
              onFocus={() => setFocusedInput('regPass')}
              onBlur={() => setFocusedInput(null)}
              required
            />
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

        {/* Sign In Form */}
        <div
          style={{
            ...styles.formContainer,
            ...styles.signInContainer,
          }}
        >
          <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 style={styles.formTitle}>欢迎回来</h2>
            <p style={styles.formSubtitle}>登录以继续管理你的账本</p>
            <input
              type="email"
              placeholder="邮箱地址"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              style={getInputStyle('loginEmail')}
              onFocus={() => setFocusedInput('loginEmail')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            <input
              type="password"
              placeholder="密码"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              style={getInputStyle('loginPass')}
              onFocus={() => setFocusedInput('loginPass')}
              onBlur={() => setFocusedInput(null)}
              required
            />
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

        {/* Overlay */}
        <div
          style={{
            ...styles.overlayContainer,
            transform: isActive ? 'translateX(-100%)' : 'translateX(0)',
          }}
        >
          <div
            style={{
              ...styles.overlay,
              transform: isActive ? 'translateX(50%)' : 'translateX(0)',
            }}
          >
            {/* Left Overlay */}
            <div style={{ ...styles.overlayPanel, ...styles.overlayLeft }}>

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
                没有账号?注册一个!
              </button>
            </div>
            {/* Right Overlay */}
            <div style={{ ...styles.overlayPanel, ...styles.overlayRight }}>
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
                已有账号?去登录
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
