import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, BookOpen, Database, GraduationCap, Menu, Users, X } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { ModeToggle } from '@/components/common/mode-toggle'
import { LogoutButton } from '@/components/common/logout-button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, initials } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'

const nav = [
  { to: '/teacher', label: 'Dashboard', icon: BarChart3, end: true },
  { to: '/teacher/exams', label: 'Exams', icon: BookOpen },
  { to: '/teacher/banks', label: 'Question Banks', icon: Database },
  { to: '/teacher/students', label: 'Students', icon: Users },
  { to: '/teacher/courses', label: 'Courses', icon: GraduationCap },
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1 px-3">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function TeacherLayout() {
  const { user } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const closeMobile = () => setMobileOpen(false)

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold">Safe Exam</p>
            <p className="text-[11px] text-muted-foreground">Teacher Console</p>
          </div>
        </div>
        <ScrollArea className="flex-1 py-3">
          <SidebarNav />
        </ScrollArea>
        <div className="border-t p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(user?.full_name ?? 'T')}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{user?.full_name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <ModeToggle />
          </div>
          <LogoutButton size="sm" className="mt-1 w-full justify-start text-muted-foreground" onOpen={closeMobile} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar shadow-xl">
            <div className="flex h-14 items-center justify-between border-b px-5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <GraduationCap className="h-4 w-4" />
                </div>
                <div className="leading-tight">
                  <p className="font-semibold">Safe Exam</p>
                  <p className="text-[11px] text-muted-foreground">Teacher Console</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <ScrollArea className="flex-1 py-3">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </ScrollArea>
            <div className="border-t p-3">
              <div className="flex items-center gap-3 rounded-lg px-2 py-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initials(user?.full_name ?? 'T')}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-medium">{user?.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <LogoutButton size="sm" className="mt-1 w-full justify-start text-muted-foreground" onOpen={closeMobile} />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Safe Exam</span>
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            <ModeToggle />
            <LogoutButton size="icon" iconOnly aria-label="Log out" />
          </div>
          <p className="hidden text-sm text-muted-foreground lg:block">Teacher workspace</p>
          <div className="hidden items-center gap-2 lg:flex">
            <ModeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
