import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/hooks/use-auth'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ProtectedRoute } from '@/components/common/protected-route'
import { PageLoader } from '@/components/common/page-loader'
import { TeacherLayout } from '@/components/layout/teacher-layout'
import { StudentLayout } from '@/components/layout/student-layout'
import { useAuth } from '@/hooks/use-auth'

const LoginPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })))
const StudentDashboardPage = lazy(() => import('@/pages/student/dashboard').then((m) => ({ default: m.StudentDashboardPage })))
const StudentExamPage = lazy(() => import('@/pages/student/exam').then((m) => ({ default: m.StudentExamPage })))
const StudentResultPage = lazy(() => import('@/pages/student/result').then((m) => ({ default: m.StudentResultPage })))
const StudentHistoryPage = lazy(() => import('@/pages/student/history').then((m) => ({ default: m.StudentHistoryPage })))
const TeacherDashboardPage = lazy(() => import('@/pages/teacher/dashboard').then((m) => ({ default: m.TeacherDashboardPage })))
const TeacherExamsPage = lazy(() => import('@/pages/teacher/exams').then((m) => ({ default: m.TeacherExamsPage })))
const ExamEditorPage = lazy(() => import('@/pages/teacher/exam-editor').then((m) => ({ default: m.ExamEditorPage })))
const TeacherBanksPage = lazy(() => import('@/pages/teacher/banks').then((m) => ({ default: m.TeacherBanksPage })))
const BankDetailPage = lazy(() => import('@/pages/teacher/bank-detail').then((m) => ({ default: m.BankDetailPage })))
const TeacherMonitorPage = lazy(() => import('@/pages/teacher/monitor').then((m) => ({ default: m.TeacherMonitorPage })))
const TeacherResultsPage = lazy(() => import('@/pages/teacher/results').then((m) => ({ default: m.TeacherResultsPage })))
const TeacherResultDetailPage = lazy(() => import('@/pages/teacher/result-detail').then((m) => ({ default: m.TeacherResultDetailPage })))
const TeacherStudentsPage = lazy(() => import('@/pages/teacher/students').then((m) => ({ default: m.TeacherStudentsPage })))
const TeacherCoursesPage = lazy(() => import('@/pages/teacher/courses').then((m) => ({ default: m.TeacherCoursesPage })))

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
            <Suspense fallback={<PageLoader />}>
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
                  <Route path="history" element={<StudentHistoryPage />} />
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
                  <Route path="courses" element={<TeacherCoursesPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
      <Toaster position="top-center" richColors />
    </ThemeProvider>
  )
}

export default App
