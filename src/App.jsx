import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
import SessionV2 from './pages/SessionV2'
import Migrate from './pages/Migrate'
import Reader from './pages/Reader'
import FillSentences from './pages/FillSentences'

// Wraps pages that require login
function Protected({ children }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
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
  // No profile row (new user) or onboarding not yet complete → send to onboarding
  if (!profile?.onboarding_complete && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
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
          <Route path="/session"          element={<Protected><SessionV2 /></Protected>} />
          <Route path="/session-v2"       element={<Navigate to="/session" replace />} />
          <Route path="/migrate"          element={<Protected><Migrate /></Protected>} />
          <Route path="/reader"           element={<Protected><Reader /></Protected>} />
          <Route path="/fill-sentences"   element={<Protected><FillSentences /></Protected>} />
          <Route path="*"            element={<Navigate to="/" />} />
        </Routes>
      </TargetLangProvider>
      </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  )
}

export default App
