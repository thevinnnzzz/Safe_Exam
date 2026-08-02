import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button, type ButtonProps } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/confirm-dialog'

type LogoutButtonProps = Omit<ButtonProps, 'onClick'> & {
  iconOnly?: boolean
  onOpen?: () => void
}

export function LogoutButton({ iconOnly, onOpen, ...props }: LogoutButtonProps) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const handleConfirm = () => {
    setOpen(false)
    logout()
    navigate('/login')
  }

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          onOpen?.()
          setOpen(true)
        }}
        {...props}
      >
        <LogOut className="h-4 w-4" />
        {iconOnly ? null : 'Log out'}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Log out?"
        description="You will be signed out of Safe Exam. Your progress is saved automatically."
        confirmLabel="Log out"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  )
}
