import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button, Input, Card, CardBody, CardHeader, Form } from '@heroui/react'
import { Mail, Lock } from 'lucide-react'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/auth'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const res = await authApi.login(email, password)
      setAuth(res.token, res.user)
      navigate('/')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col gap-1 items-center">
          <h1 className="text-2xl font-bold">Sign In</h1>
          <p className="text-sm text-gray-500">Welcome back to Homibook</p>
        </CardHeader>
        <CardBody>
          <Form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onValueChange={setEmail}
              startContent={<Mail className="w-4 h-4 text-gray-400" />}
              isRequired
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onValueChange={setPassword}
              startContent={<Lock className="w-4 h-4 text-gray-400" />}
              isRequired
            />

            {error && <p className="text-sm text-red-500">{error}</p>}

            <Button type="submit" color="primary" isLoading={isLoading}>
              Sign In
            </Button>

            <p className="text-sm text-center text-gray-500">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </Form>
        </CardBody>
      </Card>
    </div>
  )
}