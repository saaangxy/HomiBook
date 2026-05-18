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
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
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
    background: 'radial-gradient(circle, rgba(102, 126, 234, 0.4) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(80px)',
  },
  bgOrb2: {
    position: 'absolute' as const,
    bottom: '-30%',
    right: '-20%',
    width: '800px',
    height: '800px',
    background: 'radial-gradient(circle, rgba(240, 147, 251, 0.3) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(100px)',
  },
  header: {
    position: 'absolute' as const,
    top: '8%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logoContainer: {
    width: '56px',
    height: '56px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 32px rgba(102, 126, 234, 0.4)',
  },
  headerTitle: {
    fontSize: '36px',
    fontWeight: 800,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    margin: 0,
    letterSpacing: '-1px',
  },
  card: {
    position: 'relative' as const,
    width: '850px',
    height: '540px',
    borderRadius: '24px',
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  formContainer: {
    position: 'absolute' as const,
    top: 0,
    width: '50%',
    height: '100%',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    transition: 'all 0.6s ease-in-out',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center',
    padding: '0 50px',
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
    marginBottom: '24px',
    textTransform: 'capitalize' as const,
    color: '#fff',
    fontWeight: 700,
    letterSpacing: '-0.5px',
  },
  input: {
    width: '100%',
    margin: '10px 0',
    padding: '14px 16px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '12px',
    fontSize: '15px',
    color: '#fff',
    outline: 'none',
    transition: 'all 0.3s ease',
  },
  inputFocus: {
    borderColor: 'rgba(102, 126, 234, 0.8)',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    boxShadow: '0 0 0 3px rgba(102, 126, 234, 0.2)',
  },
  forgetPassword: {
    display: 'inline-block',
    textDecoration: 'none',
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'capitalize' as const,
    fontSize: '12px',
    marginTop: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  forgetPasswordHover: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  button: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '12px 50px',
    border: 'none',
    borderRadius: '25px',
    textTransform: 'uppercase' as const,
    color: 'white',
    marginTop: '16px',
    marginLeft: '50px',
    outline: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '1px',
    transition: 'all 0.3s ease',
    boxShadow: '0 8px 24px rgba(102, 126, 234, 0.4)',
  },
  buttonHover: {
    transform: 'translateY(-2px)',
    boxShadow: '0 12px 32px rgba(102, 126, 234, 0.5)',
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
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
    marginBottom: '12px',
    fontWeight: 700,
  },
  overlayText: {
    fontSize: '14px',
    margin: '12px 0 24px 0',
    lineHeight: 1.6,
    opacity: 0.9,
  },
  overlayButton: {
    backgroundColor: 'transparent',
    border: '2px solid rgba(255, 255, 255, 0.8)',
    padding: '12px 40px',
    borderRadius: '25px',
    textTransform: 'uppercase' as const,
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '1px',
    transition: 'all 0.3s ease',
  },
  overlayButtonHover: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'rgba(255, 255, 255, 1)',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: '12px',
    marginTop: '8px',
    textAlign: 'center' as const,
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
          <form onSubmit={handleRegister} style={{ width: '100%' }}>
            <h2 style={styles.formTitle}>创建账号</h2>
            <input
              type="text"
              placeholder="Username..."
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              style={getInputStyle('regName')}
              onFocus={() => setFocusedInput('regName')}
              onBlur={() => setFocusedInput(null)}
            />
            <input
              type="email"
              placeholder="Email..."
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              style={getInputStyle('regEmail')}
              onFocus={() => setFocusedInput('regEmail')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            <input
              type="password"
              placeholder="Password..."
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              style={getInputStyle('regPass')}
              onFocus={() => setFocusedInput('regPass')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            {error && <div style={styles.errorText}>{error}</div>}
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
              {isLoading ? '注册中...' : '注册'}
            </button>
          </form>
        </div>

        {/* Sign In Form */}
        <div
          style={{
            ...styles.formContainer,
            ...styles.signInContainer,
          }}
        >
          <form onSubmit={handleLogin} style={{ width: '100%' }}>
            <h2 style={styles.formTitle}>登录</h2>
            <input
              type="email"
              placeholder="Email..."
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              style={getInputStyle('loginEmail')}
              onFocus={() => setFocusedInput('loginEmail')}
              onBlur={() => setFocusedInput(null)}
              required
            />
            <input
              type="password"
              placeholder="Password..."
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
              <h2 style={styles.overlayTitle}>欢迎回来</h2>
              <p style={styles.overlayText}>登录账号开始记账</p>
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
              <h2 style={styles.overlayTitle}>欢迎!</h2>
              <p style={styles.overlayText}>注册账号管理财务</p>
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
