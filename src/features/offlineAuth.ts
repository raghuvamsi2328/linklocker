/**
 * offlineAuth.ts — Phase 2: Offline Authentication Cache.
 *
 * On every successful server login, we:
 *   1. Generate a random salt.
 *   2. Derive a PBKDF2 hash of the password with that salt.
 *   3. Store { username, salt, credentialHash, token, cachedAt } in IndexedDB.
 *
 * When offline, we:
 *   1. Look up the stored entry by username.
 *   2. Re-derive the hash with the stored salt and compare.
 *   3. If it matches, return the cached JWT.
 *
 * Phase 4: updateCachedToken() will be called after a fresh JWT is obtained
 *          post-reconnect so the cache stays valid indefinitely.
 */

import { openDB, type IDBPDatabase } from 'idb'

// ── Types ──────────────────────────────────────────────────────────

interface AuthCacheEntry {
  username: string
  salt: string           // base64-encoded 16-byte random salt
  credentialHash: string // base64-encoded 256-bit PBKDF2 output
  token: string          // JWT from the last successful server auth
  cachedAt: number       // Unix ms — used for diagnostics / future expiry
}

// ── DB helpers ─────────────────────────────────────────────────────

const DB_NAME  = 'linklocker-auth-cache'
const DB_VER   = 1
const STORE    = 'credentials'

let _db: IDBPDatabase | null = null

async function getDb(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = await openDB(DB_NAME, DB_VER, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'username' })
      }
    })
  }
  return _db
}

// ── Crypto helpers ─────────────────────────────────────────────────

const enc = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function deriveHash(password: string, saltBytes: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return toBase64(new Uint8Array(bits))
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Call after every successful server login/register.
 * Stores (or overwrites) the credential cache for this username.
 */
export async function cacheAuthCredentials(
  username: string,
  password: string,
  token: string
): Promise<void> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const credentialHash = await deriveHash(password, saltBytes)
  const entry: AuthCacheEntry = {
    username,
    salt: toBase64(saltBytes),
    credentialHash,
    token,
    cachedAt: Date.now()
  }
  const db = await getDb()
  await db.put(STORE, entry)
}

/**
 * Validates username + password against the stored offline cache.
 * Returns the cached JWT on success, or null on failure (wrong password / no cache).
 */
export async function validateOfflineCreds(
  username: string,
  password: string
): Promise<string | null> {
  const db = await getDb()
  const entry: AuthCacheEntry | undefined = await db.get(STORE, username)
  if (!entry) return null

  const saltBytes = fromBase64(entry.salt)
  const hash = await deriveHash(password, saltBytes)
  if (hash !== entry.credentialHash) return null

  return entry.token
}

/**
 * Replaces the cached JWT for a username without changing the stored credential hash.
 * Call after a successful token refresh when back online.
 */
export async function updateCachedToken(username: string, token: string): Promise<void> {
  const db = await getDb()
  const entry: AuthCacheEntry | undefined = await db.get(STORE, username)
  if (!entry) return
  await db.put(STORE, { ...entry, token, cachedAt: Date.now() })
}

/**
 * Wipes all cached credentials. Call on explicit logout.
 */
export async function clearAuthCache(): Promise<void> {
  const db = await getDb()
  await db.clear(STORE)
}
