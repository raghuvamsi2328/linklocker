/**
 * deviceIdentity.ts — Phase 2.5: Persistent per-device ECDH keypair.
 *
 * Each device generates one ECDH P-256 keypair once and stores it in IndexedDB.
 * The public key fingerprint becomes the device's stable identity:
 *   deviceId    — 16 hex chars (first 64 bits of SHA-256(publicKeyBytes))
 *   pairingCode — 4 uppercase alphanumeric chars shown in the UI for manual pairing
 *
 * Phase 4: The private key is used in an ECDH exchange to securely transfer
 *           the vault encryption key to a newly paired device.
 */

import { openDB } from 'idb'

// ── Types ──────────────────────────────────────────────────────────

export interface DeviceIdentity {
  deviceId: string       // e.g. "a3f1c92b8e4d0f7a"
  pairingCode: string    // e.g. "A3F1"  (shown to user)
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyBytes: Uint8Array // raw ECDH public key bytes (65 bytes uncompressed)
}

// ── DB ─────────────────────────────────────────────────────────────

const DB_NAME = 'linklocker-device'
const DB_VER  = 1
const STORE   = 'identity'

async function openDeviceDb() {
  return openDB(DB_NAME, DB_VER, {
    upgrade(db) {
      db.createObjectStore(STORE)
    }
  })
}

// ── Helpers ────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function fingerprintKey(rawPublicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', rawPublicKey.buffer as ArrayBuffer)
  return toHex(new Uint8Array(hash)).slice(0, 16)
}

// ── Public API ─────────────────────────────────────────────────────

let _identity: DeviceIdentity | null = null

/**
 * Returns the device identity, generating and persisting a new keypair if needed.
 * Subsequent calls return the cached in-memory result.
 */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (_identity) return _identity

  const db = await openDeviceDb()

  // Try to load existing keypair
  const stored = await db.get(STORE, 'keypair') as
    | { publicKeyBytes: string; publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey }
    | undefined

  let publicKeyBytes: Uint8Array
  let publicKey: CryptoKey
  let privateKey: CryptoKey

  if (stored) {
    publicKeyBytes = Uint8Array.from(atob(stored.publicKeyBytes), (c) => c.charCodeAt(0))
    publicKey  = await crypto.subtle.importKey('jwk', stored.publicKeyJwk,  { name: 'ECDH', namedCurve: 'P-256' }, true,  [])
    privateKey = await crypto.subtle.importKey('jwk', stored.privateKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits'])
  } else {
    // Generate new keypair
    const keypair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    )
    publicKey  = keypair.publicKey
    privateKey = keypair.privateKey

    const rawPublic  = await crypto.subtle.exportKey('raw', publicKey)
    const pubJwk     = await crypto.subtle.exportKey('jwk', publicKey)
    const privJwk    = await crypto.subtle.exportKey('jwk', privateKey)
    publicKeyBytes   = new Uint8Array(rawPublic)

    await db.put(STORE, {
      publicKeyBytes: btoa(String.fromCharCode(...publicKeyBytes)),
      publicKeyJwk: pubJwk,
      privateKeyJwk: privJwk
    }, 'keypair')
  }

  const deviceId    = await fingerprintKey(publicKeyBytes)
  const pairingCode = deviceId.slice(0, 4).toUpperCase()

  _identity = { deviceId, pairingCode, publicKey, privateKey, publicKeyBytes }
  return _identity
}
