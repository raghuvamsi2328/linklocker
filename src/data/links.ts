/**
 * data/links.ts — CRUD operations over the Yjs links map.
 *
 * Phase 3: All reads/writes go through encryptJson/decryptJson so the
 *          stored values are AES-256-GCM encrypted blobs. Legacy plain-object
 *          entries written before Phase 3 are returned transparently.
 */

import * as Y from 'yjs'
import type { LinkData } from '../yjsStore'
import { yLinks } from '../yjsStore'
import { encryptJson, decryptJson } from '../features/vaultCrypto'

export async function addLink(
  doc: Y.Doc,
  data: Omit<LinkData, 'id' | 'createdAt'>
): Promise<LinkData> {
  const link: LinkData = {
    ...data,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  }
  yLinks(doc).set(link.id, await encryptJson(link))
  return link
}

export async function updateLink(
  doc: Y.Doc,
  id: string,
  patch: Partial<Omit<LinkData, 'id' | 'createdAt'>>
): Promise<void> {
  const map      = yLinks(doc)
  const raw      = map.get(id)
  const existing = (await decryptJson(raw)) as LinkData | null
  if (!existing) return
  map.set(id, await encryptJson({ ...existing, ...patch }))
}

export function deleteLink(doc: Y.Doc, id: string): void {
  yLinks(doc).delete(id)
}

export async function getLinks(doc: Y.Doc): Promise<LinkData[]> {
  const results: LinkData[] = []
  for (const raw of yLinks(doc).values()) {
    const obj = (await decryptJson(raw)) as LinkData
    if (obj && obj.id) results.push(obj)
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
