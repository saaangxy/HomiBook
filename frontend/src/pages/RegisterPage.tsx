import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Book, Mail, Lock, User } from 'lucide-react'
import { authApi } from '../api/auth'

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  blob1: {
    position: 'absolute' as const,
    top: '-20%',
    right: '-10%',
    width: '50%',
    height: '50%',
    background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(60px)',
  },
  blob2: {
    position: 'absolute' as const,
    bottom: '-20%',
    left: '-10%',
    width: '60%',
    height: '60%',
    background: 'radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(80px)',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    padding: '48px 40px',
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    backdropFilter: 'blur(20px)',
    position: 'relative' as const,
    zIndex: 1,
  },
  logoContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginBottom: '32px',
  },
  logoBg: {
    width: '72px',
    height: '72px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderRadius: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
    boxShadow: '0 10px 30px -10px rgba(102, 126, 234, 0.5)',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#1f2937',
    margin: '0 0 8px 0',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: '15px',
    color: '#6b7280',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  inputWrapper: {
    position: 'relative' as const,
  },
  inputIcon: {
    position: 'absolute' as const,
    left: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#9ca3af',
    zIndex: 1,
    pointerEvents: 'none' as const,
  },
  input: {
    width: '100%',
    height: '52px',
    padding: '0 16px 0 48px',
    fontSize: '15px',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    outline: 'none',
    transition: 'all 0.2s ease',
    backgroundColor: '#fff',
  },
  inputFocus: {
    borderColor: '#667eea',
    boxShadow: '0 0 0 4px rgba(102, 126, 234, 0.1)',
  },
  button: {
    width: '100%',
    height: '52px',
    fontSize: '16px',
    fontWeight: 600,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginTop: '8px',
  },
  buttonHover: {
    transform: 'translateY(-2px)',
    boxShadow: '0 10px 30px -10px rgba(102, 126, 234, 0.5)',
  },
  error: {
    padding: '14px 16px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    color: '#dc2626',
    fontSize: '14px',
    textAlign: 'center' as const,
  },
  footer: {
    marginTop: '24px',
    textAlign: 'center' as const,
    fontSize: '14px',
    color: '#6b7280',
  },
  link: {
    color: '#667eea',
    textDecoration: 'none',
    fontWeight: 600,
  },
}

export function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await authApi.register(email, password, name || undefined)
      navigate('/login')
    } catch (err: any) {
      setError(err.message || 'Registration failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.blob1} />
      <div style={styles.blob2} />

      <div style={styles.card}>
        <div style={styles.logoContainer}>
          <div style={styles.logoBg}>
            <Book size={36} color="#fff" />
          </div>
          <h1 style={styles.title}>Create Account</h1>
          <p style={styles.subtitle}>Join Homibook to manage your finances</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputWrapper}>
            <User size={20} style={styles.inputIcon} />
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setFocusedInput('name')}
              onBlur={() => setFocusedInput(null)}
              style={{
                ...styles.input,
                ...(focusedInput === 'name' ? styles.inputFocus : {}),
              }}
            />
          </div>

          <div style={styles.inputWrapper}>
            <Mail size={20} style={styles.inputIcon} />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocusedInput('email')}
              onBlur={() => setFocusedInput(null)}
              style={{
                ...styles.input,
                ...(focusedInput === 'email' ? styles.inputFocus : {}),
              }}
              required
            />
          </div>

          <div style={styles.inputWrapper}>
            <Lock size={20} style={styles.inputIcon} />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusedInput('password')}
              onBlur={() => setFocusedInput(null)}
              style={{
                ...styles.input,
                ...(focusedInput === 'password' ? styles.inputFocus : {}),
              }}
              required
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="submit"
            style={{
              ...styles.button,
              ...(isHovering ? styles.buttonHover : {}),
              opacity: isLoading ? 0.7 : 1,
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            disabled={isLoading}
          >
            {isLoading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}