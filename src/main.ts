import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { addLocalLink, getLocalLinks, getUnsyncedLinks, markLinkSynced, type LocalLink } from './db'
import { attachSyncStatus } from './syncStatus'

type Session = {
  token: string
  username: string
}

type ServerLink = {
  id: number
  user_id: number
  url: string
  title: string
  group_name: string | null
  tags: string[]
  created_at: string
  synced_at: string
}

type LinkRow = {
  label: string
  url: string
  pending: boolean
  createdAt: string
  group: string
  tags: string[]
}

type GroupedRows = {
  key: string
  items: LinkRow[]
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element')
}

registerSW({
  immediate: true
})

const storedToken = localStorage.getItem('token')
const storedUsername = localStorage.getItem('username') ?? localStorage.getItem('email')

let session: Session | null =
  storedToken && storedUsername
    ? {
        token: storedToken,
        username: storedUsername
      }
    : null

let serverLinks: ServerLink[] = []
let cleanupStatus: (() => void) | null = null
const mobileMedia = window.matchMedia('(max-width: 759px)')
const bucketOpenState = new Map<string, boolean>()
let deferredInstallPrompt: InstallPromptEvent | null = null

app.innerHTML = `
  <main class="page-shell">
    <section class="landing" id="auth-panel">
      <div class="landing-copy">
        <p class="eyebrow">LINKLOCKER</p>
        <h1>Save now, sort later.</h1>
        <p class="subtitle">Notion calm + Pinterest flow. Keep links grouped, tagged, and ready offline.</p>
      </div>

      <div class="auth-card">
        <h2>Login or Register</h2>
        <form id="auth-form" class="stack">
          <input id="username" type="text" placeholder="Username" required />
          <input id="password" type="password" placeholder="Password (min 6 chars)" required minlength="6" />
          <div class="row">
            <button id="login-btn" data-mode="login" type="submit">Login</button>
            <button data-mode="register" type="button" id="register-btn" class="secondary">Register</button>
          </div>
        </form>
        <p id="auth-message" class="muted"></p>
      </div>
    </section>

    <section id="app-panel" hidden>
      <header class="topbar panel">
        <div>
          <p class="eyebrow">YOUR SPACE</p>
          <h2>Boards by Groups or Tags</h2>
        </div>
        <div class="row">
          <div id="sync-status" class="status-pill">Checking sync state...</div>
          <button id="install-btn" type="button" class="secondary install-btn" hidden>Install App</button>
          <button id="logout-btn" type="button" class="secondary">Logout</button>
        </div>
      </header>

      <section class="panel mobile-card" id="composer-card">
        <button type="button" class="mobile-card-toggle" data-card-toggle aria-expanded="false">Add Link</button>
        <div class="mobile-card-body" data-card-body>
          <form id="link-form" class="stack">
            <input id="link-url" type="url" placeholder="https://example.com" required />
            <input id="link-title" type="text" placeholder="Title (optional)" />
            <input id="link-group" type="text" placeholder="Group (optional, ex: Work)" />
            <input id="link-tags" type="text" placeholder="Tags (optional, comma separated)" />
            <button type="submit">Save Link</button>
          </form>
          <p id="save-message" class="muted"></p>
        </div>
      </section>

      <section class="panel mobile-card" id="filters-card">
        <button type="button" class="mobile-card-toggle" data-card-toggle aria-expanded="false">Filters & View</button>
        <div class="mobile-card-body" data-card-body>
          <div class="filter-grid">
            <select id="view-mode">
              <option value="group">View: Groups</option>
              <option value="tag">View: Tags</option>
            </select>
            <select id="filter-group">
              <option value="">All groups</option>
            </select>
            <input id="filter-tag" type="text" placeholder="Filter by tag" />
            <button id="clear-filters" type="button" class="secondary">Clear filters</button>
          </div>
        </div>
      </section>

      <section id="link-board" class="board"></section>
    </section>
  </main>
`

const syncStatusEl = document.querySelector<HTMLElement>('#sync-status')
const authPanel = document.querySelector<HTMLElement>('#auth-panel')
const appPanel = document.querySelector<HTMLElement>('#app-panel')
const authForm = document.querySelector<HTMLFormElement>('#auth-form')
const loginBtn = document.querySelector<HTMLButtonElement>('#login-btn')
const registerBtn = document.querySelector<HTMLButtonElement>('#register-btn')
const authMessage = document.querySelector<HTMLElement>('#auth-message')
const installBtn = document.querySelector<HTMLButtonElement>('#install-btn')
const logoutBtn = document.querySelector<HTMLButtonElement>('#logout-btn')
const linkForm = document.querySelector<HTMLFormElement>('#link-form')
const saveMessage = document.querySelector<HTMLElement>('#save-message')
const linkBoard = document.querySelector<HTMLElement>('#link-board')
const urlInput = document.querySelector<HTMLInputElement>('#link-url')
const titleInput = document.querySelector<HTMLInputElement>('#link-title')
const groupInput = document.querySelector<HTMLInputElement>('#link-group')
const tagsInput = document.querySelector<HTMLInputElement>('#link-tags')
const viewModeSelect = document.querySelector<HTMLSelectElement>('#view-mode')
const groupFilter = document.querySelector<HTMLSelectElement>('#filter-group')
const tagFilter = document.querySelector<HTMLInputElement>('#filter-tag')
const clearFiltersBtn = document.querySelector<HTMLButtonElement>('#clear-filters')
const composerCard = document.querySelector<HTMLElement>('#composer-card')
const filtersCard = document.querySelector<HTMLElement>('#filters-card')

if (
  !syncStatusEl ||
  !authPanel ||
  !appPanel ||
  !authForm ||
  !loginBtn ||
  !registerBtn ||
  !authMessage ||
  !installBtn ||
  !logoutBtn ||
  !linkForm ||
  !saveMessage ||
  !linkBoard ||
  !urlInput ||
  !titleInput ||
  !groupInput ||
  !tagsInput ||
  !viewModeSelect ||
  !groupFilter ||
  !tagFilter ||
  !clearFiltersBtn ||
  !composerCard ||
  !filtersCard
) {
  throw new Error('Missing expected UI elements')
}

cleanupStatus = attachSyncStatus(syncStatusEl)

const setAuthUi = (loggedIn: boolean) => {
  authPanel.hidden = loggedIn
  appPanel.hidden = !loggedIn
  authPanel.setAttribute('aria-hidden', String(loggedIn))
  appPanel.setAttribute('aria-hidden', String(!loggedIn))

  // Force visibility in case any CSS or browser quirk ignores hidden toggling.
  authPanel.style.display = loggedIn ? 'none' : 'grid'
  appPanel.style.display = loggedIn ? 'block' : 'none'

  if (loggedIn) {
    authMessage.textContent = ''
    authForm.reset()
  }
}

const setMobileCardExpanded = (card: HTMLElement, expanded: boolean) => {
  const toggle = card.querySelector<HTMLButtonElement>('[data-card-toggle]')
  const body = card.querySelector<HTMLElement>('[data-card-body]')

  if (!toggle || !body) {
    return
  }

  toggle.setAttribute('aria-expanded', String(expanded))
  body.hidden = !expanded
}

const syncMobileCardsForViewport = () => {
  const cards = [composerCard, filtersCard]

  if (!mobileMedia.matches) {
    for (const card of cards) {
      setMobileCardExpanded(card, true)
    }
    return
  }

  for (const card of cards) {
    const toggle = card.querySelector<HTMLButtonElement>('[data-card-toggle]')
    const isExpanded = toggle?.getAttribute('aria-expanded') === 'true'
    setMobileCardExpanded(card, isExpanded)
  }
}

const saveSession = (newSession: Session) => {
  session = newSession
  localStorage.setItem('token', newSession.token)
  localStorage.setItem('username', newSession.username)
  localStorage.removeItem('email')
}

const clearSession = () => {
  session = null
  localStorage.removeItem('token')
  localStorage.removeItem('username')
  localStorage.removeItem('email')
  serverLinks = []
}

const authorizedFetch = async (input: string, init: RequestInit = {}) => {
  if (!session) {
    throw new Error('Not authenticated')
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.token}`)

  return fetch(input, {
    ...init,
    headers
  })
}

const parseTags = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const hydrateGroupFilter = (rows: LinkRow[]) => {
  const currentGroup = groupFilter.value
  const groups = [...new Set(rows.map((row) => row.group).filter(Boolean))].sort((a, b) => a.localeCompare(b))

  groupFilter.innerHTML = '<option value="">All groups</option>'
  for (const group of groups) {
    const option = document.createElement('option')
    option.value = group
    option.textContent = group
    groupFilter.append(option)
  }

  if (groups.includes(currentGroup)) {
    groupFilter.value = currentGroup
  } else {
    groupFilter.value = ''
  }
}

const groupRowsForBoard = (rows: LinkRow[], mode: 'group' | 'tag'): GroupedRows[] => {
  const groupedMap = new Map<string, LinkRow[]>()

  for (const row of rows) {
    if (mode === 'group') {
      const key = row.group || 'No Group'
      groupedMap.set(key, [...(groupedMap.get(key) ?? []), row])
      continue
    }

    const tags = row.tags.length > 0 ? row.tags : ['No Tag']
    for (const tag of tags) {
      groupedMap.set(tag, [...(groupedMap.get(tag) ?? []), row])
    }
  }

  return [...groupedMap.entries()]
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

const renderLinks = async () => {
  const localLinks = await getLocalLinks()
  const pendingLocalLinks = localLinks.filter((link) => !link.synced)

  const rows: LinkRow[] = []

  for (const link of serverLinks) {
    rows.push({
      label: link.title || link.url,
      url: link.url,
      pending: false,
      createdAt: link.created_at,
      group: link.group_name ?? '',
      tags: link.tags ?? []
    })
  }

  for (const link of pendingLocalLinks) {
    rows.push({
      label: link.title || link.url,
      url: link.url,
      pending: true,
      createdAt: link.createdAt,
      group: link.group,
      tags: link.tags
    })
  }

  hydrateGroupFilter(rows)

  const selectedGroup = groupFilter.value
  const tagNeedle = tagFilter.value.trim().toLowerCase()
  const mode = viewModeSelect.value === 'tag' ? 'tag' : 'group'

  const filteredRows = rows.filter((row) => {
    const matchesGroup = !selectedGroup || row.group === selectedGroup
    const matchesTag = !tagNeedle || row.tags.some((tag) => tag.includes(tagNeedle))
    return matchesGroup && matchesTag
  })

  if (filteredRows.length === 0) {
    linkBoard.innerHTML = '<p class="empty-state">It feels empty here.</p>'
    return
  }

  const groups = groupRowsForBoard(filteredRows, mode)

  linkBoard.innerHTML = groups
    .map(
      (grouped, index) => {
        const bucketStateKey = `${mode}:${grouped.key}`
        const expanded = mobileMedia.matches ? (bucketOpenState.get(bucketStateKey) ?? index === 0) : true
        const encodedBucketKey = encodeURIComponent(bucketStateKey)

        return `
      <article class="bucket">
        <header class="bucket-head">
          <button type="button" class="bucket-toggle" data-bucket-toggle data-bucket-key="${encodedBucketKey}" aria-expanded="${expanded}">
            <span>${escapeHtml(grouped.key)}</span>
            <small>${grouped.items.length} item${grouped.items.length === 1 ? '' : 's'}</small>
          </button>
        </header>
        <div class="pin-grid" ${expanded ? '' : 'hidden'}>
          ${grouped.items
            .map(
              (row) => `
              <a class="pin ${row.pending ? 'pending' : ''}" href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">
                <p class="pin-title">${escapeHtml(row.label)}</p>
                <p class="pin-url">${escapeHtml(row.url)}</p>
                <div class="pin-meta">
                  ${row.group ? `<span>${escapeHtml(row.group)}</span>` : ''}
                  ${row.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}
                </div>
                <small>${row.pending ? 'Pending sync' : 'Synced'}</small>
              </a>
            `
            )
            .join('')}
        </div>
      </article>
    `
      }
    )
    .join('')
}

const loadServerLinks = async () => {
  if (!session) {
    return
  }

  const response = await authorizedFetch('/api/links')
  if (response.status === 401) {
    throw new Error('AUTH_EXPIRED')
  }

  if (!response.ok) {
    throw new Error('Failed to fetch links')
  }

  const payload = (await response.json()) as { links: ServerLink[] }
  serverLinks = payload.links
}

const syncPendingLinks = async () => {
  if (!session) {
    return
  }

  const pending = await getUnsyncedLinks()
  if (pending.length === 0) {
    return
  }

  for (const link of pending) {
    const response = await authorizedFetch('/api/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: link.url,
        title: link.title,
        group: link.group,
        tags: link.tags
      })
    }).catch(() => null)

    if (!response || !response.ok) {
      continue
    }

    const payload = (await response.json()) as { link: ServerLink }
    await markLinkSynced(link.id, payload.link.id)
  }

  await loadServerLinks()
  await renderLinks()
}

const authenticate = async (mode: 'login' | 'register') => {
  const username = (document.querySelector<HTMLInputElement>('#username')?.value ?? '').trim().toLowerCase()
  const password = document.querySelector<HTMLInputElement>('#password')?.value ?? ''

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

  saveSession({
    token: payload.token,
    username: payload.user.username
  })
}

const setAuthPending = (isPending: boolean) => {
  loginBtn.disabled = isPending
  registerBtn.disabled = isPending
  loginBtn.textContent = isPending ? 'Signing in...' : 'Login'
}

const runAuth = async (mode: 'login' | 'register') => {
  setAuthPending(true)
  authMessage.textContent = ''

  try {
    await authenticate(mode)
    setAuthUi(true)
    await loadServerLinks()
    await syncPendingLinks()
    await renderLinks()
  } catch (error) {
    const fallbackMessage = 'Unable to connect. Is the API server running?'
    authMessage.textContent = error instanceof Error ? error.message || fallbackMessage : fallbackMessage
  } finally {
    setAuthPending(false)
  }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  await runAuth('login')
})

loginBtn.addEventListener('click', async (event) => {
  event.preventDefault()

  if (!authForm.reportValidity()) {
    return
  }

  await runAuth('login')
})

for (const card of [composerCard, filtersCard]) {
  const toggle = card.querySelector<HTMLButtonElement>('[data-card-toggle]')

  toggle?.addEventListener('click', () => {
    if (!mobileMedia.matches) {
      return
    }

    const isExpanded = toggle.getAttribute('aria-expanded') === 'true'
    setMobileCardExpanded(card, !isExpanded)
  })
}

mobileMedia.addEventListener('change', () => {
  syncMobileCardsForViewport()
  void renderLinks()
})

linkBoard.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const toggle = target.closest<HTMLButtonElement>('[data-bucket-toggle]')

  if (!toggle || !mobileMedia.matches) {
    return
  }

  const encodedBucketKey = toggle.dataset.bucketKey
  if (!encodedBucketKey) {
    return
  }

  const bucketStateKey = decodeURIComponent(encodedBucketKey)
  const isExpanded = toggle.getAttribute('aria-expanded') === 'true'
  bucketOpenState.set(bucketStateKey, !isExpanded)
  void renderLinks()
})

registerBtn.addEventListener('click', async () => {
  await runAuth('register')
})

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event as InstallPromptEvent
  installBtn.hidden = false
})

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    return
  }

  await deferredInstallPrompt.prompt()
  const choice = await deferredInstallPrompt.userChoice
  if (choice.outcome === 'accepted') {
    installBtn.hidden = true
  }

  deferredInstallPrompt = null
})

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null
  installBtn.hidden = true
})

logoutBtn.addEventListener('click', () => {
  clearSession()
  setAuthUi(false)
  linkBoard.innerHTML = ''
  saveMessage.textContent = ''
})

viewModeSelect.addEventListener('change', () => {
  void renderLinks()
})

groupFilter.addEventListener('change', () => {
  void renderLinks()
})

tagFilter.addEventListener('input', () => {
  void renderLinks()
})

clearFiltersBtn.addEventListener('click', () => {
  groupFilter.value = ''
  tagFilter.value = ''
  void renderLinks()
})

linkForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  if (!session) {
    saveMessage.textContent = 'Please login first'
    return
  }

  const url = urlInput.value.trim()
  const title = titleInput.value.trim()
  const group = groupInput.value.trim()
  const tags = parseTags(tagsInput.value)

  if (!url) {
    saveMessage.textContent = 'URL is required'
    return
  }

  let localLink: LocalLink
  try {
    localLink = await addLocalLink(url, title, group, tags)
  } catch {
    saveMessage.textContent = 'Unable to store locally'
    return
  }

  await renderLinks()
  urlInput.value = ''
  titleInput.value = ''
  groupInput.value = ''
  tagsInput.value = ''

  try {
    const response = await authorizedFetch('/api/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, title, group, tags })
    })

    if (!response.ok) {
      throw new Error('Server rejected save')
    }

    const payload = (await response.json()) as { link: ServerLink }
    await markLinkSynced(localLink.id, payload.link.id)
    await loadServerLinks()
    saveMessage.textContent = 'Link saved and synced'
  } catch {
    saveMessage.textContent = navigator.onLine
      ? 'Save queued. Sync will retry in background.'
      : 'Offline - link stored locally and queued for sync.'
  }

  await renderLinks()
  void syncPendingLinks()
})

window.addEventListener('online', () => {
  void syncPendingLinks()
})

if (session) {
  setAuthUi(true)
  syncMobileCardsForViewport()
  void (async () => {
    try {
      await loadServerLinks()
      await syncPendingLinks()
      await renderLinks()
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_EXPIRED') {
        clearSession()
        setAuthUi(false)
        authMessage.textContent = 'Session expired. Please login again.'
        return
      }

      // Keep session on transient errors (offline/server down) so refresh does not force logout.
      authMessage.textContent = 'Could not refresh data right now. Please try again.'
      await renderLinks()
    }
  })()
} else {
  setAuthUi(false)
  syncMobileCardsForViewport()
}

window.addEventListener('beforeunload', () => {
  cleanupStatus?.()
})
