import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSupabase, getToken } from '@/lib/supabase'

/**
 * Live grade updates for one student attempt (result page only).
 *
 * Subscribes to UPDATEs of the student's own `student_exams` row; any change
 * (manual grade, auto-grade re-run) refetches the result and toasts. This is
 * the only realtime subscription in the app — dashboard/history use 30s
 * polling instead, keeping concurrent sockets in the dozens (Free-tier-safe).
 *
 * Auth note: this project signs custom JWTs (no supabase-auth session), so
 * the socket must be handed the student's token explicitly via
 * `realtime.setAuth`. Without it the socket authenticates as `anon` and RLS
 * (`to authenticated`) silently delivers nothing.
 */
export function useAttemptRealtime(studentExamId: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!studentExamId) return
    const token = getToken()
    if (!token) return

    const client = getSupabase()
    client.realtime.setAuth(token)

    const channel = client
      .channel(`student-attempt-${studentExamId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'student_exams',
          filter: `id=eq.${studentExamId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['student-result', studentExamId] })
          toast.info('Your grade was updated by your instructor.', { duration: 4000 })
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [studentExamId, queryClient])
}
