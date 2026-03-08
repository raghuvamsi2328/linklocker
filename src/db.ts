import { openDB } from 'idb'

export type LocalLink = {
  id: string
  url: string
  title: string
  description?: string
  image?: string
  favicon?: string
  siteName?: string
  group: string
  tags: string[]
  createdAt: string
  synced: boolean
  localOnly?: boolean
  serverId?: number
}

type LinkSaverDB = {
  links: {
    key: string
    value: LocalLink
    indexes: {
      'by-synced': boolean
    }
  }
}

const dbPromise = openDB<LinkSaverDB>('link-saver-db', 2, {
  upgrade(db, _oldVersion, _newVersion, transaction) {
    const hasStore = db.objectStoreNames.contains('links')
    const store = hasStore ? transaction.objectStore('links') : db.createObjectStore('links', { keyPath: 'id' })

    if (!store.indexNames.contains('by-synced')) {
      store.createIndex('by-synced', 'synced')
    }
  }
})

export async function addLocalLink(
  url: string,
  title: string,
  group: string,
  tags: string[],
  options: {
    synced?: boolean
    localOnly?: boolean
    description?: string
    image?: string
    favicon?: string
    siteName?: string
  } = {}
): Promise<LocalLink> {
  const synced = options.synced ?? false

  const link: LocalLink = {
    id: crypto.randomUUID(),
    url,
    title,
    description: options.description,
    image: options.image,
    favicon: options.favicon,
    siteName: options.siteName,
    group,
    tags,
    createdAt: new Date().toISOString(),
    synced,
    localOnly: options.localOnly ?? false
  }

  const db = await dbPromise
  await db.put('links', link)
  return link
}

export async function getUnsyncedLinks(): Promise<LocalLink[]> {
  const db = await dbPromise
  const rows = await db.getAll('links')
  return rows.filter((row) => !row.synced)
}

export async function getUnsyncedCount(): Promise<number> {
  const rows = await getUnsyncedLinks()
  return rows.length
}

export async function markLinkSynced(localId: string, serverId: number): Promise<void> {
  const db = await dbPromise
  const link = await db.get('links', localId)

  if (!link) {
    return
  }

  link.synced = true
  link.serverId = serverId
  await db.put('links', link)
}

export async function getLocalLinks(): Promise<LocalLink[]> {
  const db = await dbPromise
  const links = await db.getAll('links')
  return links.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
