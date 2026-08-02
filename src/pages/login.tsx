import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, GraduationCap, KeyRound, Loader2, Lock, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { AuthError } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModeToggle } from '@/components/common/mode-toggle'
import { cn } from '@/lib/utils'

const loginSchema = z.object({
  identifier: z.string().min(3, 'Enter your Student ID or email.'),
  password: z.string().min(1, 'Password is required.'),
})

type LoginForm = z.infer<typeof loginSchema>

type Tab = 'student' | 'teacher'

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [tab, setTab] = useState<Tab>('student')
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  const from = (location.state as { from?: string } | null)?.from

  useEffect(() => {
    if (user) {
      navigate(user.role === 'teacher' ? '/teacher' : '/student', { replace: true })
    }
  }, [user, navigate])

  const onSubmit = async (values: LoginForm) => {
    setServerError(null)
    try {
      const u = await login({ identifier: values.identifier.trim(), password: values.password, mode: tab })
      navigate(u.role === 'teacher' ? from?.startsWith('/teacher') ? from : '/teacher' : '/student', { replace: true })
    } catch (err) {
      setServerError(err instanceof AuthError ? err.message : 'Login failed. Please try again.')
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-sky-50 via-white to-blue-50 p-4 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-80 w-80 animate-float-soft rounded-full bg-sky-300/30 blur-3xl dark:bg-sky-600/20" />
        <div
          className="absolute -right-20 top-1/4 h-72 w-72 animate-float-soft rounded-full bg-blue-300/30 blur-3xl dark:bg-blue-600/20"
          style={{ animationDelay: '-6s' }}
        />
        <div
          className="absolute -bottom-24 left-1/4 h-80 w-80 animate-float-soft rounded-full bg-indigo-200/30 blur-3xl dark:bg-indigo-600/20"
          style={{ animationDelay: '-12s' }}
        />
      </div>

      <div className="absolute right-4 top-4">
        <ModeToggle />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <GraduationCap className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Safe Exam</h1>
            <p className="text-sm text-muted-foreground">Secure online examination system</p>
          </div>
        </div>

        <Card className="animate-fade-in" style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              {tab === 'student' ? 'Use your Student ID and password.' : 'Use your teacher email and password.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setTab('student')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all',
                  tab === 'student' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <UserRound className="h-4 w-4" />
                Student
              </button>
              <button
                type="button"
                onClick={() => setTab('teacher')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all',
                  tab === 'teacher' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                Teacher
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">{tab === 'student' ? 'Student ID' : 'Email'}</Label>
                <div className="relative">
                  <UserRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="identifier"
                    placeholder={tab === 'student' ? 'e.g. STU-2026-001' : 'e.g. teacher@example.com'}
                    className="pl-9"
                    autoComplete="username"
                    {...register('identifier')}
                  />
                </div>
                {errors.identifier ? <p className="text-xs text-destructive">{errors.identifier.message}</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="pl-9 pr-10"
                    autoComplete="current-password"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="group absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 animate-fade-in" />
                    ) : (
                      <Eye className="h-4 w-4 animate-fade-in" />
                    )}
                  </button>
                </div>
                {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
              </div>

              {serverError ? (
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <KeyRound className="h-4 w-4 shrink-0" />
                  {serverError}
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-5 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Demo accounts</p>
              <p className="mt-1">
                Teacher: <code className="rounded bg-background px-1">teacher@example.com</code> /{' '}
                <code className="rounded bg-background px-1">teacher123</code>
              </p>
              <p className="mt-0.5">
                Student: <code className="rounded bg-background px-1">STU-2026-001</code> /{' '}
                <code className="rounded bg-background px-1">student123</code>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
