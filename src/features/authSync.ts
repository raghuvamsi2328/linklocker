/**
 * authSync.ts — Server authentication + offline fallback.
 *
 * Phase 2: On every successful server login, credentials are cached in
 *           IndexedDB (PBKDF2 hash + salt). When offline, the app falls
 *           back to local validation and returns the cached JWT.
 * Phase 4: WebRTC signalling connection will be added here.
 */

import type { AppSession } from './sessionMode'
import { cacheAuthCredentials, validateOfflineCreds } from './offlineAuth'

// ── Helpers ────────────────────────────────────────────────────────

async function postJson(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|failed/i.test((err as TypeError).message)
}

// ── Online auth ────────────────────────────────────────────────────

/**
 * Authenticates against the server. On success, caches credentials in
 * IndexedDB so the user can log in offline next time.
 */
export async function authenticateWithCredentials(
  mode: 'login' | 'register',
  username: string,
  password: string
): Promise<AppSession> {
  const res = await postJson(`/auth/${mode}`, { username, password })
  const data = (await res.json()) as {
    error?: string
    token?: string
    user?: { username: string }
  }

  if (!res.ok) {
    throw new Error(data.error ?? (mode === 'login' ? 'Login failed' : 'Registration failed'))
  }

  if (!data.token || !data.user?.username) {
    throw new Error('Invalid server response')
  }

  const session: AppSession = { token: data.token, username: data.user.username }

  // Cache credentials for offline login (fire-and-forget — never blocks the UI)
  cacheAuthCredentials(username, password, data.token).catch(() => {
    // Storage errors are non-fatal
  })

  return session
}

// ── Offline auth fallback ──────────────────────────────────────────

/**
 * Validates credentials against the local IndexedDB cache.
 * Returns an AppSession using the cached JWT, or throws if credentials
 * are wrong or no cache exists for this username.
 */
export async function authenticateOffline(
  username: string,
  password: string
): Promise<AppSession> {
  const token = await validateOfflineCreds(username, password)

  if (!token) {
    throw new Error('No offline credentials found. Please sign in while connected.')
  }

  return { token, username }
}

// ── Combined auth (online → offline fallback) ──────────────────────

/**
 * Tries the server first. If the request fails due to a network error
 * (not a 4xx), falls back to the offline credential cache.
 *
 * Registration always requires a network connection.
 */
export async function authenticate(
  mode: 'login' | 'register',
  username: string,
  password: string
): Promise<{ session: AppSession; wasOffline: boolean }> {
  try {
    const session = await authenticateWithCredentials(mode, username, password)
    return { session, wasOffline: false }
  } catch (err) {
    if (mode === 'register' || !isNetworkError(err)) {
      throw err
    }
    // Network is down — try offline cache
    const session = await authenticateOffline(username, password)
    return { session, wasOffline: true }
  }
}
