import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { LanguageProvider } from './lib/i18n'
import { TargetLangProvider } from './lib/TargetLangContext'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Dictionary from './pages/Dictionary'
import Flashcards from './pages/Flashcards'
import FillBlank from './pages/FillBlank'
import MultipleChoice from './pages/MultipleChoice'
import WordChoice from './pages/WordChoice'
import Chat from './pages/Chat'
import PrepExercise from './pages/PrepExercise'
import PrepSession from './pages/PrepSession'
import WordOrder from './pages/WordOrder'
import ActiveRecall from './pages/ActiveRecall'
import SentenceWriting from './pages/SentenceWriting'
import Exercises from './pages/Exercises'
import Session from './pages/Session'

// Wraps pages that require login
function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  )
  if (!user) return <Navigate to="/auth" replace />
  return children
}

function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
      <AuthProvider>
      <TargetLangProvider>
        <Routes>
          <Route path="/"            element={<Landing />} />
          <Route path="/auth"        element={<Auth />} />
          <Route path="/onboarding"  element={<Protected><Onboarding /></Protected>} />
          <Route path="/dashboard"   element={<Protected><Dashboard /></Protected>} />
          <Route path="/dictionary"  element={<Protected><Dictionary /></Protected>} />
          <Route path="/flashcards"  element={<Protected><Flashcards /></Protected>} />
          <Route path="/fill-blank"  element={<Protected><FillBlank /></Protected>} />
          <Route path="/multiple-choice" element={<Protected><MultipleChoice /></Protected>} />
          <Route path="/word-choice" element={<Protected><WordChoice /></Protected>} />
          <Route path="/chat"        element={<Protected><Chat /></Protected>} />
          <Route path="/prepositions" element={<Protected><PrepExercise /></Protected>} />
          <Route path="/prep-session" element={<Protected><PrepSession /></Protected>} />
          <Route path="/word-order"    element={<Protected><WordOrder /></Protected>} />
          <Route path="/active-recall"    element={<Protected><ActiveRecall /></Protected>} />
          <Route path="/sentence-writing" element={<Protected><SentenceWriting /></Protected>} />
          <Route path="/exercises"        element={<Protected><Exercises /></Protected>} />
          <Route path="/session"          element={<Protected><Session /></Protected>} />
          <Route path="*"            element={<Navigate to="/" />} />
        </Routes>
      </TargetLangProvider>
      </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  )
}

export default App
