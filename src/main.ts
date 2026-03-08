import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { addLocalLink, getLocalLinks, markLinkSynced, type LocalLink } from './db'
import { attachSyncStatus } from './syncStatus'
import {
  authenticateWithCredentials,
  createServerLinkForSession,
  fetchServerLinksForSession,
  syncPendingLinksForSession,
  type ServerLink
} from './features/authSync'
import { applyGroupFilterOptions, buildLinkRows, renderBoardHtml } from './features/board'
import {
  detectMetadata,
  deriveFallbackTitle,
  isUrlLike,
  parseSharedPayloadFromLocation,
  toValidUrl
} from './features/linkMetadata'
import {
  clearStoredSession,
  getStoredOfflineMode,
  getStoredSession,
  setStoredOfflineMode,
  storeSession,
  type AppSession
} from './features/sessionMode'
import {
  applyPendingSharedPayloadToForm,
  setMobileCardExpanded,
  syncMobileCardsForViewport
} from './features/uiState'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element')
}

registerSW({ immediate: true })

let session: AppSession | null = getStoredSession()
let offlineOnlyMode = getStoredOfflineMode()
let serverLinks: ServerLink[] = []
let cleanupStatus: (() => void) | null = null
const mobileMedia = window.matchMedia('(max-width: 759px)')
const bucketOpenState = new Map<string, boolean>()
let deferredInstallPrompt: InstallPromptEvent | null = null
let latestMetadata:
  | {
      url: string
      description: string
      image: string
      favicon: string
      siteName: string
    }
  | null = null

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
          <button id="offline-mode-btn" type="button" class="secondary">Use Offline Mode (No Account)</button>
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
          <label for="mode-switch" class="mode-switch-label">Mode</label>
          <select id="mode-switch" class="mode-switch" aria-label="App mode">
            <option value="account">Account Sync</option>
            <option value="offline">Offline Local</option>
          </select>
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
            <button id="metadata-btn" type="button" class="secondary">Auto Fill Metadata</button>
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
const offlineModeBtn = document.querySelector<HTMLButtonElement>('#offline-mode-btn')
const authMessage = document.querySelector<HTMLElement>('#auth-message')
const modeSwitch = document.querySelector<HTMLSelectElement>('#mode-switch')
const installBtn = document.querySelector<HTMLButtonElement>('#install-btn')
const logoutBtn = document.querySelector<HTMLButtonElement>('#logout-btn')
const linkForm = document.querySelector<HTMLFormElement>('#link-form')
const saveMessage = document.querySelector<HTMLElement>('#save-message')
const linkBoard = document.querySelector<HTMLElement>('#link-board')
const urlInput = document.querySelector<HTMLInputElement>('#link-url')
const titleInput = document.querySelector<HTMLInputElement>('#link-title')
const groupInput = document.querySelector<HTMLInputElement>('#link-group')
const tagsInput = document.querySelector<HTMLInputElement>('#link-tags')
const metadataBtn = document.querySelector<HTMLButtonElement>('#metadata-btn')
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
  !offlineModeBtn ||
  !authMessage ||
  !modeSwitch ||
  !installBtn ||
  !logoutBtn ||
  !linkForm ||
  !saveMessage ||
  !linkBoard ||
  !urlInput ||
  !titleInput ||
  !groupInput ||
  !tagsInput ||
  !metadataBtn ||
  !viewModeSelect ||
  !groupFilter ||
  !tagFilter ||
  !clearFiltersBtn ||
  !composerCard ||
  !filtersCard
) {
  throw new Error('Missing expected UI elements')
}

const pendingSharedPayload = parseSharedPayloadFromLocation(window.location, window.history)
const mobileCards = [composerCard, filtersCard]

cleanupStatus = attachSyncStatus(syncStatusEl, {
  isLocalOnlyMode: () => offlineOnlyMode
})

const setAuthUi = (loggedIn: boolean) => {
  authPanel.hidden = loggedIn
  appPanel.hidden = !loggedIn
  authPanel.setAttribute('aria-hidden', String(loggedIn))
  appPanel.setAttribute('aria-hidden', String(!loggedIn))
  authPanel.style.display = loggedIn ? 'none' : 'grid'
  appPanel.style.display = loggedIn ? 'block' : 'none'

  if (loggedIn) {
    authMessage.textContent = ''
    authForm.reset()
  }
}

const clearSession = () => {
  session = null
  clearStoredSession()
  serverLinks = []
}

const setOfflineMode = (enabled: boolean) => {
  offlineOnlyMode = enabled
  modeSwitch.value = enabled ? 'offline' : 'account'
  setStoredOfflineMode(enabled)

  if (enabled) {
    if (session) {
      clearSession()
    }
    serverLinks = []
    logoutBtn.textContent = 'Exit Offline Mode'
    authMessage.textContent = ''
    return
  }

  logoutBtn.textContent = 'Logout'
}

const saveSession = (newSession: AppSession) => {
  setOfflineMode(false)
  session = newSession
  storeSession(newSession)
}

const renderLinks = async () => {
  const localLinks = await getLocalLinks()
  const rows = buildLinkRows(serverLinks, localLinks, offlineOnlyMode)
  applyGroupFilterOptions(groupFilter, rows)

  const selectedGroup = groupFilter.value
  const tagNeedle = tagFilter.value.trim().toLowerCase()
  const mode = viewModeSelect.value === 'tag' ? 'tag' : 'group'

  linkBoard.innerHTML = renderBoardHtml(rows, selectedGroup, tagNeedle, mode, mobileMedia.matches, bucketOpenState)
}

const loadServerLinks = async () => {
  if (!session || offlineOnlyMode) {
    return
  }

  serverLinks = await fetchServerLinksForSession(session)
}

const syncPendingLinks = async () => {
  if (!session || offlineOnlyMode) {
    return
  }

  await syncPendingLinksForSession(session)
  await loadServerLinks()
  await renderLinks()
}

const activateOfflineMode = async () => {
  setOfflineMode(true)
  setAuthUi(true)
  syncMobileCardsForViewport(mobileCards, mobileMedia)
  applyPendingSharedPayloadToForm(pendingSharedPayload, {
    urlInput,
    titleInput,
    saveMessage,
    composerCard,
    mobileMedia
  })
  await renderLinks()
  saveMessage.textContent = 'Offline mode enabled. Links stay on this device only.'
}

const activateAccountMode = async () => {
  setOfflineMode(false)

  if (!session) {
    setAuthUi(false)
    linkBoard.innerHTML = ''
    saveMessage.textContent = ''
    authMessage.textContent = 'Account Sync mode selected. Login or register to continue.'
    return
  }

  setAuthUi(true)
  await loadServerLinks()
  await syncPendingLinks()
  await renderLinks()
}

const parseTags = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)

const setAuthPending = (isPending: boolean) => {
  loginBtn.disabled = isPending
  registerBtn.disabled = isPending
  offlineModeBtn.disabled = isPending
  loginBtn.textContent = isPending ? 'Signing in...' : 'Login'
}

const runAuth = async (mode: 'login' | 'register') => {
  setAuthPending(true)
  authMessage.textContent = ''

  try {
    const username = (document.querySelector<HTMLInputElement>('#username')?.value ?? '').trim().toLowerCase()
    const password = document.querySelector<HTMLInputElement>('#password')?.value ?? ''
    const newSession = await authenticateWithCredentials(mode, username, password)

    saveSession(newSession)
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

registerBtn.addEventListener('click', async () => {
  await runAuth('register')
})

offlineModeBtn.addEventListener('click', async () => {
  await activateOfflineMode()
})

modeSwitch.addEventListener('change', () => {
  void (async () => {
    try {
      if (modeSwitch.value === 'offline') {
        await activateOfflineMode()
      } else {
        await activateAccountMode()
      }
    } catch {
      saveMessage.textContent = 'Unable to switch mode right now. Please retry.'
    }
  })()
})

for (const card of mobileCards) {
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
  syncMobileCardsForViewport(mobileCards, mobileMedia)
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

metadataBtn.addEventListener('click', async () => {
  const parsedUrl = toValidUrl(urlInput.value.trim())

  if (!parsedUrl) {
    saveMessage.textContent = 'Enter a valid URL first to fetch metadata.'
    return
  }

  metadataBtn.disabled = true
  metadataBtn.textContent = 'Fetching metadata...'

  try {
    const metadata = await detectMetadata(parsedUrl)
    latestMetadata = {
      url: parsedUrl,
      description: metadata.description,
      image: metadata.image,
      favicon: metadata.favicon,
      siteName: metadata.siteName
    }

    if (metadata.title && (!titleInput.value.trim() || isUrlLike(titleInput.value.trim()))) {
      titleInput.value = metadata.title
    }

    const existingTags = parseTags(tagsInput.value)
    const mergedTags = [...new Set([...existingTags, ...metadata.tags])]
    tagsInput.value = mergedTags.join(', ')

    const extraBits = [
      metadata.siteName ? `site: ${metadata.siteName}` : '',
      metadata.description ? 'description found' : '',
      metadata.image ? 'image found' : '',
      metadata.favicon ? 'favicon found' : ''
    ].filter(Boolean)

    saveMessage.textContent = metadata.title
      ? `Metadata applied${extraBits.length ? ` (${extraBits.join(', ')})` : ''}. You can edit title/tags before saving.`
      : 'No rich metadata found. Added best-effort tags from domain.'
  } finally {
    metadataBtn.disabled = false
    metadataBtn.textContent = 'Auto Fill Metadata'
  }
})

urlInput.addEventListener('blur', () => {
  if (titleInput.value.trim()) {
    return
  }

  const url = toValidUrl(urlInput.value)
  if (!url) {
    return
  }

  titleInput.value = deriveFallbackTitle(url)
})

urlInput.addEventListener('input', () => {
  const parsedUrl = toValidUrl(urlInput.value.trim())
  if (!latestMetadata || !parsedUrl || latestMetadata.url !== parsedUrl) {
    latestMetadata = null
  }
})

linkForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  if (!session && !offlineOnlyMode) {
    saveMessage.textContent = 'Please login first'
    return
  }

  const url = toValidUrl(urlInput.value.trim())
  const title = titleInput.value.trim()
  const group = groupInput.value.trim()
  const tags = parseTags(tagsInput.value)

  if (!url) {
    saveMessage.textContent = 'URL is required'
    return
  }

  let localLink: LocalLink
  try {
    const metadataForSave = latestMetadata && latestMetadata.url === url ? latestMetadata : null
    localLink = await addLocalLink(url, title, group, tags, {
      synced: offlineOnlyMode,
      localOnly: offlineOnlyMode,
      description: metadataForSave?.description,
      image: metadataForSave?.image,
      favicon: metadataForSave?.favicon,
      siteName: metadataForSave?.siteName
    })
  } catch {
    saveMessage.textContent = 'Unable to store locally'
    return
  }

  await renderLinks()
  urlInput.value = ''
  titleInput.value = ''
  groupInput.value = ''
  tagsInput.value = ''

  if (offlineOnlyMode) {
    saveMessage.textContent = 'Saved locally in offline mode.'
    await renderLinks()
    return
  }

  try {
    if (!session) {
      throw new Error('Not authenticated')
    }

    const created = await createServerLinkForSession(session, {
      url,
      title,
      group,
      tags,
      description: localLink.description,
      image: localLink.image,
      favicon: localLink.favicon,
      siteName: localLink.siteName
    })

    await markLinkSynced(localLink.id, created.id)
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
  if (offlineOnlyMode) {
    void activateAccountMode()
    return
  }

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

window.addEventListener('online', () => {
  void syncPendingLinks()
})

if (session || offlineOnlyMode) {
  setAuthUi(true)
  modeSwitch.value = offlineOnlyMode ? 'offline' : 'account'
  if (offlineOnlyMode) {
    logoutBtn.textContent = 'Exit Offline Mode'
  }
  syncMobileCardsForViewport(mobileCards, mobileMedia)
  applyPendingSharedPayloadToForm(pendingSharedPayload, {
    urlInput,
    titleInput,
    saveMessage,
    composerCard,
    mobileMedia
  })

  void (async () => {
    try {
      if (!offlineOnlyMode) {
        await loadServerLinks()
        await syncPendingLinks()
      }
      await renderLinks()
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_EXPIRED') {
        clearSession()
        setAuthUi(false)
        authMessage.textContent = 'Session expired. Please login again.'
        return
      }

      authMessage.textContent = 'Could not refresh data right now. Please try again.'
      await renderLinks()
    }
  })()
} else {
  setAuthUi(false)
  modeSwitch.value = 'account'
  syncMobileCardsForViewport(mobileCards, mobileMedia)

  if (pendingSharedPayload) {
    authMessage.textContent = 'Login/register or use Offline Mode to save the shared link.'
  }
}

window.addEventListener('beforeunload', () => {
  cleanupStatus?.()
})
