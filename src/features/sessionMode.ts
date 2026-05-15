export type AppSession = {
  token: string
  username: string
}

const TOKEN_KEY = 'token'
const USERNAME_KEY = 'username'
const LEGACY_EMAIL_KEY = 'email'
const OFFLINE_MODE_KEY = 'offline-only-mode'
const OFFLINE_DISPLAY_NAME_KEY = 'offline-display-name'

export const getStoredSession = (): AppSession | null => {
  const storedToken = localStorage.getItem(TOKEN_KEY)
  const storedUsername = localStorage.getItem(USERNAME_KEY) ?? localStorage.getItem(LEGACY_EMAIL_KEY)

  if (!storedToken || !storedUsername) {
    return null
  }

  return {
    token: storedToken,
    username: storedUsername
  }
}

export const storeSession = (session: AppSession): void => {
  localStorage.setItem(TOKEN_KEY, session.token)
  localStorage.setItem(USERNAME_KEY, session.username)
  localStorage.removeItem(LEGACY_EMAIL_KEY)
}

export const clearStoredSession = (): void => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USERNAME_KEY)
  localStorage.removeItem(LEGACY_EMAIL_KEY)
}

export const getStoredOfflineMode = (): boolean => {
  return localStorage.getItem(OFFLINE_MODE_KEY) === 'true'
}

export const setStoredOfflineMode = (enabled: boolean): void => {
  if (enabled) {
    localStorage.setItem(OFFLINE_MODE_KEY, 'true')
    return
  }

  localStorage.removeItem(OFFLINE_MODE_KEY)
}

export const getStoredOfflineDisplayName = (): string | null => {
  const raw = localStorage.getItem(OFFLINE_DISPLAY_NAME_KEY)
  const trimmed = raw?.trim() ?? ''
  return trimmed || null
}

export const setStoredOfflineDisplayName = (name: string): void => {
  const trimmed = name.trim()
  if (!trimmed) {
    localStorage.removeItem(OFFLINE_DISPLAY_NAME_KEY)
    return
  }
  localStorage.setItem(OFFLINE_DISPLAY_NAME_KEY, trimmed)
}
