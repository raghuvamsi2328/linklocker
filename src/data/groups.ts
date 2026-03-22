/**
 * data/groups.ts — CRUD operations over the Yjs groups map.
 *
 * Phase 3: All reads/writes go through encryptJson/decryptJson.
 */

import * as Y from 'yjs'
import type { GroupData } from '../yjsStore'
import { yGroups } from '../yjsStore'
import { encryptJson, decryptJson } from '../features/vaultCrypto'

const PALETTE      = ['accent', 'teal', 'lavender', 'rose', 'sky', 'lime', 'sand']
const DEFAULT_EMOJIS = ['📁', '🔥', '🎨', '🔧', '🧠', '⭐', '📚']

export async function createGroup(
  doc: Y.Doc,
  name: string,
  opts?: { color?: string; emoji?: string }
): Promise<GroupData> {
  const groups = yGroups(doc)
  const order  = groups.size
  const group: GroupData = {
    id:    crypto.randomUUID(),
    name:  name.trim(),
    color: opts?.color ?? PALETTE[order % PALETTE.length],
    emoji: opts?.emoji ?? DEFAULT_EMOJIS[order % DEFAULT_EMOJIS.length],
    order
  }
  groups.set(group.id, await encryptJson(group))
  return group
}

export async function updateGroup(
  doc: Y.Doc,
  id: string,
  patch: Partial<Omit<GroupData, 'id'>>
): Promise<void> {
  const map      = yGroups(doc)
  const raw      = map.get(id)
  const existing = (await decryptJson(raw)) as GroupData | null
  if (!existing) return
  map.set(id, await encryptJson({ ...existing, ...patch }))
}

export function deleteGroup(doc: Y.Doc, id: string): void {
  yGroups(doc).delete(id)
}

export async function getGroups(doc: Y.Doc): Promise<GroupData[]> {
  const results: GroupData[] = []
  for (const raw of yGroups(doc).values()) {
    const obj = (await decryptJson(raw)) as GroupData
    if (obj && obj.id) results.push(obj)
  }
  return results.sort((a, b) => a.order - b.order)
}

/**
 * Find an existing group by name (case-insensitive) or create one.
 * Used when user types a group name in the "Add Link" form.
 */
export async function findOrCreateGroup(doc: Y.Doc, name: string): Promise<GroupData | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const all      = await getGroups(doc)
  const existing = all.find((g) => g.name.toLowerCase() === trimmed.toLowerCase())
  return existing ?? createGroup(doc, trimmed)
}
