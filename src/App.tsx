import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/hooks/use-auth'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ProtectedRoute } from '@/components/common/protected-route'
import { TeacherLayout } from '@/components/layout/teacher-layout'
import { StudentLayout } from '@/components/layout/student-layout'
import { LoginPage } from '@/pages/login'
import { StudentDashboardPage } from '@/pages/student/dashboard'
import { StudentExamPage } from '@/pages/student/exam'
import { StudentResultPage } from '@/pages/student/result'
import { TeacherDashboardPage } from '@/pages/teacher/dashboard'
import { TeacherExamsPage } from '@/pages/teacher/exams'
import { ExamEditorPage } from '@/pages/teacher/exam-editor'
import { TeacherBanksPage } from '@/pages/teacher/banks'
import { BankDetailPage } from '@/pages/teacher/bank-detail'
import { TeacherMonitorPage } from '@/pages/teacher/monitor'
import { TeacherResultsPage } from '@/pages/teacher/results'
import { TeacherResultDetailPage } from '@/pages/teacher/result-detail'
import { TeacherStudentsPage } from '@/pages/teacher/students'
import { useAuth } from '@/hooks/use-auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

function HomeRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.role === 'teacher' ? '/teacher' : '/student'} replace />
}

function NotFound() {
  const { user } = useAuth()
  return <Navigate to={user ? (user.role === 'teacher' ? '/teacher' : '/student') : '/login'} replace />
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="safe-exam-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<HomeRedirect />} />

              <Route
                path="/student"
                element={
                  <ProtectedRoute role="student">
                    <StudentLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<StudentDashboardPage />} />
                <Route path="exam/:examId" element={<StudentExamPage />} />
                <Route path="result/:studentExamId" element={<StudentResultPage />} />
              </Route>

              <Route
                path="/teacher"
                element={
                  <ProtectedRoute role="teacher">
                    <TeacherLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<TeacherDashboardPage />} />
                <Route path="exams" element={<TeacherExamsPage />} />
                <Route path="exams/new" element={<ExamEditorPage />} />
                <Route path="exams/:examId" element={<ExamEditorPage />} />
                <Route path="exams/:examId/monitor" element={<TeacherMonitorPage />} />
                <Route path="exams/:examId/results" element={<TeacherResultsPage />} />
                <Route path="exams/:examId/results/:studentExamId" element={<TeacherResultDetailPage />} />
                <Route path="banks" element={<TeacherBanksPage />} />
                <Route path="banks/:bankId" element={<BankDetailPage />} />
                <Route path="students" element={<TeacherStudentsPage />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
      <Toaster position="top-center" richColors />
    </ThemeProvider>
  )
}

export default App
