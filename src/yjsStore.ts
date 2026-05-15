/**
 * yjsStore.ts — Yjs CRDT document + y-indexeddb persistence
 *
 * Phase 1: Local-first vault (y-indexeddb).
 * Phase 3: Y.Map now stores encrypted JSON strings (values are `unknown`).
 * Phase 4: y-websocket provider enables live sync between devices via server relay.
 */

import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'

// ── Data types ───────────────────────────────────────────────────

export type LinkData = {
  id: string
  url: string
  title: string
  description?: string
  image?: string
  favicon?: string
  siteName?: string
  groupId: string        // UUID of a GroupData entry, '' = ungrouped
  tags: string[]
  notes?: string
  createdAt: string      // ISO timestamp
}

export type GroupData = {
  id: string
  name: string
  color: string          // palette key: 'accent' | 'teal' | 'lavender' …
  emoji: string
  order: number
}

// ── Singleton vault ──────────────────────────────────────────────

let _doc: Y.Doc | null = null
let _persistence: IndexeddbPersistence | null = null
let _wsProvider: WebsocketProvider | null = null
let _ready: Promise<void> | null = null

/**
 * Initialise (or return the existing) Yjs document backed by IndexedDB.
 * Uses a generic anonymous vault ID — call switchVault(userId) after login
 * to move to a user-specific, isolated store.
 * Await `ready` before reading data.
 */
export function initVault(): { doc: Y.Doc; ready: Promise<void> } {
  if (_doc && _ready) return { doc: _doc, ready: _ready }

  _doc = new Y.Doc()
  _persistence = new IndexeddbPersistence('bnkr-vault-anonymous', _doc)

  _ready = new Promise<void>((resolve) => {
    _persistence!.once('synced', resolve)
  })

  return { doc: _doc, ready: _ready }
}

/**
 * Tears down the current vault and re-creates it scoped to a specific user.
 * Call this after every successful login so that different accounts on the
 * same device get completely separate IndexedDB stores.
 * Returns the new doc after it has synced from IndexedDB.
 */
export async function switchVault(userId: string): Promise<Y.Doc> {
  const vaultId = `bnkr-vault-v1-${userId}`
  console.log('[vault] switchVault →', vaultId)

  _wsProvider?.destroy()
  _persistence?.destroy()
  _doc?.destroy()
  _wsProvider  = null
  _doc         = null
  _ready       = null

  _doc         = new Y.Doc()
  _persistence = new IndexeddbPersistence(vaultId, _doc)

  await new Promise<void>((resolve) => { _persistence!.once('synced', resolve) })

  console.log('[vault] switchVault synced —', {
    links:  _doc.getMap('links').size,
    groups: _doc.getMap('groups').size,
  })

  return _doc
}

/** Get the vault doc (throws if not yet initialised). */
export function getVault(): Y.Doc {
  if (!_doc) throw new Error('Vault not initialised — call initVault() first')
  return _doc
}

// ── WebSocket sync (Phase 4) ─────────────────────────────────────

/**
 * Connects the vault to the sync server via y-websocket.
 * `room`      — shared room name (e.g. "bnkr-vault-alice")
 * `serverUrl` — WebSocket URL of the sync server (e.g. "ws://localhost:3000/sync")
 * `auth`      — JWT token + deviceId required by the server trust gate
 *
 * The server acts as a relay; it only sees encrypted binary Yjs updates.
 * Vault data is encrypted by Phase 3 before entering Yjs, so the server
 * cannot read any link or group content.
 */
export function connectSync(
  room: string,
  serverUrl: string,
  auth?: { token: string; deviceId: string }
): WebsocketProvider {
  if (_wsProvider) return _wsProvider
  if (!_doc) throw new Error('Vault not initialised')

  console.log('[sync] connectSync room=', room, 'server=', serverUrl)

  _wsProvider = new WebsocketProvider(serverUrl, room, _doc, auth ? { params: auth } : undefined)

  _wsProvider.on('status', (event: { status: string }) => {
    console.log('[sync] status —', event.status)
  })

  _wsProvider.on('sync', (synced: boolean) => {
    console.log('[sync] synced=', synced, {
      links:  _doc!.getMap('links').size,
      groups: _doc!.getMap('groups').size,
    })
  })

  _doc.on('update', (_update: Uint8Array, origin: unknown) => {
    console.log('[yjs] doc update — origin:', origin instanceof Object ? origin.constructor?.name : origin, {
      links:  _doc!.getMap('links').size,
      groups: _doc!.getMap('groups').size,
    })
  })

  return _wsProvider
}

/** Tear down sync connection (call on logout). */
export function disconnectSync(): void {
  _wsProvider?.destroy()
  _wsProvider = null
}

/** Returns the active WebSocket sync provider, or null if not connected. */
export function getSync(): WebsocketProvider | null {
  return _wsProvider
}

// ── Typed map accessors ──────────────────────────────────────────
//
// Values are `unknown` because Phase 3 stores encrypted JSON strings,
// while legacy Phase 1 entries are plain objects. The data layer handles both.

export const yLinks  = (doc: Y.Doc) => doc.getMap<unknown>('links')
export const yGroups = (doc: Y.Doc) => doc.getMap<unknown>('groups')
