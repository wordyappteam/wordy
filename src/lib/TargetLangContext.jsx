import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'

export const SUPPORTED_LANGUAGES = [
  { code: 'de', label: 'DE', name: 'German',    speechLocale: 'de-DE', features: { prepositionDrills: true,  fillBlank: true,  multipleChoice: true  } },
  { code: 'en', label: 'EN', name: 'English',   speechLocale: 'en-US', features: { prepositionDrills: false, fillBlank: false, multipleChoice: false } },
  { code: 'uk', label: 'UK', name: 'Ukrainian', speechLocale: 'uk-UA', features: { prepositionDrills: false, fillBlank: false, multipleChoice: false } },
]

const TargetLangContext = createContext({})

export function TargetLangProvider({ children }) {
  const { profile, updateProfile } = useAuth()
  const [targetLang, setTargetLangState] = useState('de')

  useEffect(() => {
    if (profile?.active_target_language) {
      setTargetLangState(profile.active_target_language)
    }
  }, [profile])

  function setTargetLang(code) {
    setTargetLangState(code)
    updateProfile({ active_target_language: code })
  }

  const langDef = SUPPORTED_LANGUAGES.find(l => l.code === targetLang) ?? SUPPORTED_LANGUAGES[0]

  return (
    <TargetLangContext.Provider value={{
      targetLang,
      setTargetLang,
      targetLanguageName: langDef.name,
      speechLocale:       langDef.speechLocale,
      features:           langDef.features,
    }}>
      {children}
    </TargetLangContext.Provider>
  )
}

export const useTargetLang = () => useContext(TargetLangContext)
