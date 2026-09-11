import { Link, NavLink, Outlet } from 'react-router-dom'
import { GraduationCap, History, LayoutDashboard } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { ModeToggle } from '@/components/common/mode-toggle'
import { LogoutButton } from '@/components/common/logout-button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { initials } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function StudentLayout() {
  const { user } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur lg:px-8">
        <div className="flex items-center gap-4">
          <Link to="/student" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <p className="font-semibold">Safe Exam</p>
              <p className="text-[11px] text-muted-foreground">Student Portal</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/student"
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </NavLink>
            <NavLink
              to="/student/history"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-3 sm:flex">
            <Avatar className="h-6 w-6">
              <AvatarFallback>{initials(user?.full_name ?? 'S')}</AvatarFallback>
            </Avatar>
            <div className="leading-tight">
              <p className="text-xs font-medium">{user?.full_name}</p>
              <p className="text-[10px] text-muted-foreground">{user?.student_id}</p>
            </div>
          </div>
          <ModeToggle />
          <LogoutButton size="icon" iconOnly aria-label="Log out" />
        </div>
      </header>
      <main className="flex-1 p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}
