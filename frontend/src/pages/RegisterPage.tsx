import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button, Input, Card, CardBody, CardHeader, Form } from '@heroui/react'
import { Mail, Lock, User as UserIcon } from 'lucide-react'
import { authApi } from '../api/auth'

export function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col gap-1 items-center">
          <h1 className="text-2xl font-bold">Sign Up</h1>
          <p className="text-sm text-gray-500">Create your Homibook account</p>
        </CardHeader>
        <CardBody>
          <Form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Name"
              type="text"
              value={name}
              onValueChange={setName}
              startContent={<UserIcon className="w-4 h-4 text-gray-400" />}
            />
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
              description="At least 6 characters"
              isRequired
            />

            {error && <p className="text-sm text-red-500">{error}</p>}

            <Button type="submit" color="primary" isLoading={isLoading}>
              Sign Up
            </Button>

            <p className="text-sm text-center text-gray-500">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </Form>
        </CardBody>
      </Card>
    </div>
  )
}