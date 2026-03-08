import { getUnsyncedLinks, markLinkSynced, type LocalLink } from '../db'
import type { AppSession } from './sessionMode'

export type ServerLink = {
  id: number
  user_id: number
  url: string
  title: string
  description?: string
  image?: string
  favicon?: string
  site_name?: string
  group_name: string | null
  tags: string[]
  created_at: string
  synced_at: string
}

export const authorizedFetchWithSession = async (
  session: AppSession,
  input: string,
  init: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.token}`)

  return fetch(input, {
    ...init,
    headers
  })
}

export const authenticateWithCredentials = async (
  mode: 'login' | 'register',
  username: string,
  password: string
): Promise<AppSession> => {
  const response = await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  })

  const payload = (await response.json()) as { token?: string; user?: { username: string }; error?: string }

  if (!response.ok || !payload.token || !payload.user) {
    throw new Error(payload.error ?? `${mode} failed`)
  }

  return {
    token: payload.token,
    username: payload.user.username
  }
}

export const fetchServerLinksForSession = async (session: AppSession): Promise<ServerLink[]> => {
  const response = await authorizedFetchWithSession(session, '/api/links')

  if (response.status === 401) {
    throw new Error('AUTH_EXPIRED')
  }

  if (!response.ok) {
    throw new Error('Failed to fetch links')
  }

  const payload = (await response.json()) as { links: ServerLink[] }
  return payload.links
}

export const createServerLinkForSession = async (
  session: AppSession,
  link: Pick<LocalLink, 'url' | 'title' | 'group' | 'tags' | 'description' | 'image' | 'favicon' | 'siteName'>
): Promise<ServerLink> => {
  const response = await authorizedFetchWithSession(session, '/api/links', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: link.url,
      title: link.title,
      description: link.description,
      image: link.image,
      favicon: link.favicon,
      siteName: link.siteName,
      group: link.group,
      tags: link.tags
    })
  })

  if (!response.ok) {
    throw new Error('Server rejected save')
  }

  const payload = (await response.json()) as { link: ServerLink }
  return payload.link
}

export const syncPendingLinksForSession = async (session: AppSession): Promise<void> => {
  const pending = await getUnsyncedLinks()
  if (pending.length === 0) {
    return
  }

  for (const link of pending) {
    try {
      const created = await createServerLinkForSession(session, link)
      await markLinkSynced(link.id, created.id)
    } catch {
      // Keep unsynced records for later retries.
    }
  }
}
