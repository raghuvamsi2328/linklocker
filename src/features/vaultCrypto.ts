/**
 * vaultCrypto.ts — Phase 3: AES-256-GCM vault encryption.
 *
 * Each device has one random AES-256-GCM master key stored in IndexedDB.
 * The key never leaves the device unless the user explicitly pairs a new device
 * (Phase 4 will use ECDH to transfer it securely).
 *
 * All link and group data written to the Yjs vault is encrypted at the data layer.
 * Legacy unencrypted entries (Phase 1 data) are detected and returned as-is,
 * so existing vaults migrate forward transparently on first write.
 */

import { openDB } from 'idb'

// ── Types ──────────────────────────────────────────────────────────

interface EncryptedBlob {
  iv: string  // base64
  ct: string  // base64
}

// ── Helpers ────────────────────────────────────────────────────────

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function isEncryptedBlob(parsed: unknown): parsed is EncryptedBlob {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as Record<string, unknown>).iv === 'string' &&
    typeof (parsed as Record<string, unknown>).ct === 'string'
  )
}

// ── Key storage ────────────────────────────────────────────────────

const DB_NAME = 'linklocker-vault-key'
const DB_VER  = 1
const STORE   = 'keys'

async function openKeyDb() {
  return openDB(DB_NAME, DB_VER, {
    upgrade(db) {
      db.createObjectStore(STORE)
    }
  })
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const db    = await openKeyDb()
  const raw   = await db.get(STORE, 'master') as string | undefined

  if (raw) {
    const keyBytes = fromBase64(raw)
    return crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    )
  }

  // First boot — generate and persist a random master key
  const key    = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const bytes  = await crypto.subtle.exportKey('raw', key)
  await db.put(STORE, toBase64(new Uint8Array(bytes)), 'master')
  return key
}

// ── Module state ───────────────────────────────────────────────────

let _key: CryptoKey | null = null

/**
 * Must be called once at boot (before reading or writing vault data).
 * Loads (or creates) the device master key from IndexedDB.
 */
export async function initVaultCrypto(): Promise<void> {
  _key = await loadOrCreateKey()
}

/**
 * Derives a deterministic AES-256-GCM vault key from username + password
 * using PBKDF2 (200k iterations, SHA-256). Called after every successful
 * login so that all devices with the same credentials share the same key
 * and can decrypt each other's synced data.
 *
 * The derived key is persisted in IndexedDB so offline sessions re-use it
 * without needing the plaintext password again.
 */
export async function deriveKeyFromCredentials(username: string, password: string): Promise<void> {
  const te   = new TextEncoder()
  const salt = te.encode(`bnkr-vault-v1-${username.toLowerCase()}`)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    te.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  _key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )

  // Persist so subsequent visits and offline sessions load the same key
  const db  = await openKeyDb()
  const raw = await crypto.subtle.exportKey('raw', _key)
  await db.put(STORE, toBase64(new Uint8Array(raw)), 'master')

  // Log first 8 bytes as hex fingerprint — safe to log, not the full key
  const fp = Array.from(new Uint8Array(raw).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')
  console.log('[crypto] key derived for user — fingerprint (first 8B):', fp, 'salt username:', username.toLowerCase())
}

/**
 * Returns the raw key bytes (extractable).
 * Used in Phase 4 for secure key transfer during device pairing.
 */
export async function exportVaultKey(): Promise<Uint8Array> {
  if (!_key) throw new Error('Vault crypto not initialised')
  const raw = await crypto.subtle.exportKey('raw', _key)
  return new Uint8Array(raw)
}

/**
 * Replaces the vault key with imported bytes received from a paired device.
 * After this, all subsequent reads will fail until the vault is re-read
 * with the new key — the caller is responsible for re-reading.
 */
export async function importVaultKey(bytes: Uint8Array): Promise<void> {
  const db  = await openKeyDb()
  _key = await crypto.subtle.importKey(
    'raw',
    bytes.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
  await db.put(STORE, toBase64(bytes), 'master')
}

// ── Encrypt / decrypt ──────────────────────────────────────────────

/**
 * Encrypts any JSON-serialisable value and returns a compact string blob.
 * If the vault key is not yet initialised, returns plain JSON (should not
 * happen in normal flow — call initVaultCrypto() at boot first).
 */
export async function encryptJson(obj: unknown): Promise<string> {
  if (!_key) { console.warn('[crypto] encryptJson called with no key — storing plain JSON'); return JSON.stringify(obj) }

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    _key,
    enc.encode(JSON.stringify(obj))
  )

  const blob: EncryptedBlob = { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
  return JSON.stringify(blob)
}

/**
 * Decrypts a value stored in the vault.
 * Handles three cases:
 *   1. Non-string (legacy Phase 1 plain object stored directly in Y.Map) → returned as-is
 *   2. Encrypted blob string ({ iv, ct }) → decrypted
 *   3. Plain JSON string (written before encryption was active) → parsed as-is
 */
export async function decryptJson(raw: unknown): Promise<unknown> {
  // Legacy: plain object value stored directly in Y.Map (Phase 1 data)
  if (typeof raw !== 'string') return raw

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }

  if (!_key || !isEncryptedBlob(parsed)) {
    // Either no key yet, or this is unencrypted plain-JSON (written before Phase 3)
    return parsed
  }

  try {
    const iv = fromBase64(parsed.iv)
    const ct = fromBase64(parsed.ct)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      _key,
      ct.buffer as ArrayBuffer
    )
    return JSON.parse(dec.decode(plain))
  } catch (err) {
    // Decryption failure — almost always a key mismatch
    console.error('[crypto] decryptJson FAILED — likely key mismatch between devices. Error:', err)
    return parsed
  }
}
