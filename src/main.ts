import './style.css'
import './styles/login.css'
import './styles/app.css'
import { registerSW } from 'virtual:pwa-register'
import { renderLoginPageHtml } from './pages/LoginPage'
import { renderAppPageHtml } from './pages/AppPage'
import { addLocalLink, getLocalLinks, markLinkSynced, type LocalLink } from './db'
import { attachSyncStatus } from './syncStatus'
import {
  authenticateWithCredentials,
  createServerLinkForSession,
  fetchServerLinksForSession,
  syncPendingLinksForSession,
  type ServerLink
} from './features/authSync'
import { applyGroupFilterOptions, buildLinkRows, renderBoardHtml, type LinkRow } from './features/board'
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
import { applyPendingSharedPayloadToForm } from './features/uiState'

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
    ${renderLoginPageHtml()}
    ${renderAppPageHtml()}
  </main>
`

// ── Element queries ──────────────────────────────────────────────

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
const groupCard = document.querySelector<HTMLElement>('#group-card')
const groupForm = document.querySelector<HTMLFormElement>('#group-form')
const groupNameInput = document.querySelector<HTMLInputElement>('#group-name')
const groupMessage = document.querySelector<HTMLElement>('#group-message')

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
  !groupCard ||
  !groupForm ||
  !groupNameInput ||
  !groupMessage
) {
  throw new Error('Missing expected UI elements')
}

const pendingSharedPayload = parseSharedPayloadFromLocation(window.location, window.history)

cleanupStatus = attachSyncStatus(syncStatusEl, {
  isLocalOnlyMode: () => offlineOnlyMode
})

// ── Greeting & stats ─────────────────────────────────────────────

const updateGreeting = (username: string | null) => {
  const el = document.querySelector<HTMLElement>('#app-greeting')
  if (el) el.textContent = username ? `Hello, ${username}!` : 'Hello!'
}

const updateStats = (rows: LinkRow[]) => {
  const statLinks = document.querySelector<HTMLElement>('#stat-links')
  const statGroups = document.querySelector<HTMLElement>('#stat-groups')
  const statTags = document.querySelector<HTMLElement>('#stat-tags')
  if (statLinks) statLinks.textContent = String(rows.length)
  if (statGroups) {
    const groups = new Set(rows.map((r) => r.group).filter(Boolean))
    statGroups.textContent = String(groups.size)
  }
  if (statTags) {
    const tags = new Set(rows.flatMap((r) => r.tags))
    statTags.textContent = String(tags.size)
  }
}

// ── Auth UI ───────────────────────────────────────────────────────

const setAuthUi = (loggedIn: boolean) => {
  authPanel.hidden = loggedIn
  appPanel.hidden = !loggedIn
  authPanel.setAttribute('aria-hidden', String(loggedIn))
  appPanel.setAttribute('aria-hidden', String(!loggedIn))
  authPanel.style.display = loggedIn ? 'none' : 'grid'
  appPanel.style.display = loggedIn ? 'flex' : 'none'

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
    if (session) clearSession()
    serverLinks = []
    logoutBtn.setAttribute('aria-label', 'Exit offline mode')
    return
  }

  logoutBtn.setAttribute('aria-label', 'Logout')
}

const saveSession = (newSession: AppSession) => {
  setOfflineMode(false)
  session = newSession
  storeSession(newSession)
}

// ── Data ─────────────────────────────────────────────────────────

const renderLinks = async () => {
  const localLinks = await getLocalLinks()
  const rows = buildLinkRows(serverLinks, localLinks, offlineOnlyMode)
  applyGroupFilterOptions(groupFilter, rows)

  const selectedGroup = groupFilter.value
  const tagNeedle = tagFilter.value.trim().toLowerCase()
  const mode = viewModeSelect.value === 'tag' ? 'tag' : 'group'

  linkBoard.innerHTML = renderBoardHtml(rows, selectedGroup, tagNeedle, mode, bucketOpenState)
  updateStats(rows)
}

const loadServerLinks = async () => {
  if (!session || offlineOnlyMode) return
  serverLinks = await fetchServerLinksForSession(session)
}

const syncPendingLinks = async () => {
  if (!session || offlineOnlyMode) return
  await syncPendingLinksForSession(session)
  await loadServerLinks()
  await renderLinks()
}

const activateOfflineMode = async () => {
  setOfflineMode(true)
  setAuthUi(true)
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

// ── Auth logic ───────────────────────────────────────────────────

const setAuthPending = (isPending: boolean) => {
  loginBtn.disabled = isPending
  registerBtn.disabled = isPending
  offlineModeBtn.disabled = isPending
  const loginLabel = loginBtn.querySelector<HTMLElement>('.login-btn-label')
  if (loginLabel) {
    loginLabel.textContent = isPending ? 'Signing in…' : 'Sign In'
  }
}

const runAuth = async (mode: 'login' | 'register') => {
  setAuthPending(true)
  authMessage.textContent = ''

  try {
    const username = (document.querySelector<HTMLInputElement>('#username')?.value ?? '').trim().toLowerCase()
    const password = document.querySelector<HTMLInputElement>('#password')?.value ?? ''
    const newSession = await authenticateWithCredentials(mode, username, password)

    saveSession(newSession)
    updateGreeting(newSession.username)
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

// ── Login page event listeners ───────────────────────────────────

authForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  await runAuth('login')
})

loginBtn.addEventListener('click', async (event) => {
  event.preventDefault()
  if (!authForm.reportValidity()) return
  await runAuth('login')
})

registerBtn.addEventListener('click', async () => {
  await runAuth('register')
})

offlineModeBtn.addEventListener('click', async () => {
  await activateOfflineMode()
})

// Login / Register tab switching
const tabLogin = document.querySelector<HTMLButtonElement>('#tab-login')
const tabRegister = document.querySelector<HTMLButtonElement>('#tab-register')

const setAuthTab = (mode: 'login' | 'register') => {
  const isLogin = mode === 'login'
  tabLogin?.classList.toggle('login-tab--active', isLogin)
  tabRegister?.classList.toggle('login-tab--active', !isLogin)
  tabLogin?.setAttribute('aria-selected', String(isLogin))
  tabRegister?.setAttribute('aria-selected', String(!isLogin))
  loginBtn.hidden = !isLogin
  registerBtn.hidden = isLogin
}

tabLogin?.addEventListener('click', () => setAuthTab('login'))
tabRegister?.addEventListener('click', () => setAuthTab('register'))

// Password visibility toggle
const togglePasswordBtn = document.querySelector<HTMLButtonElement>('#toggle-password')
const eyeIcon = document.querySelector<HTMLElement>('#eye-icon')
const passwordInput = document.querySelector<HTMLInputElement>('#password')

togglePasswordBtn?.addEventListener('click', () => {
  if (!passwordInput) return
  const isHidden = passwordInput.type === 'password'
  passwordInput.type = isHidden ? 'text' : 'password'
  if (eyeIcon) eyeIcon.textContent = isHidden ? 'visibility_off' : 'visibility'
  togglePasswordBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password')
})

// ── App page event listeners ─────────────────────────────────────

// Bookmark animation
const bookmarkBtn = document.querySelector<HTMLButtonElement>('#bookmark-anim')
const bookmarkIcon = bookmarkBtn?.querySelector<HTMLElement>('.bookmark-icon')

const popBookmark = () => {
  if (!bookmarkIcon) return
  bookmarkIcon.classList.remove('is-popping')
  void bookmarkIcon.offsetWidth // force reflow
  bookmarkIcon.classList.add('is-popping')
}

bookmarkBtn?.addEventListener('click', popBookmark)
bookmarkBtn?.addEventListener('touchstart', popBookmark, { passive: true })
bookmarkIcon?.addEventListener('animationend', () => {
  bookmarkIcon.classList.remove('is-popping')
})

// Action card toggles (always collapsible on all screen sizes)
const setupActionCardToggles = () => {
  const toggles = appPanel.querySelectorAll<HTMLButtonElement>('[data-card-toggle], [data-action-toggle]')
  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      const card = toggle.closest<HTMLElement>('.action-card')
      if (!card) return
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true'
      const body = card.querySelector<HTMLElement>('[data-card-body], [data-action-body]')
      toggle.setAttribute('aria-expanded', String(!isExpanded))
      if (body) body.hidden = isExpanded
    })
  }
}
setupActionCardToggles()

// Collections view tabs (Groups / Tags)
const viewGroupBtn = document.querySelector<HTMLButtonElement>('#view-group-btn')
const viewTagBtn = document.querySelector<HTMLButtonElement>('#view-tag-btn')

const setCollectionsView = (mode: 'group' | 'tag') => {
  const isGroup = mode === 'group'
  viewGroupBtn?.classList.toggle('coll-view-tab--active', isGroup)
  viewTagBtn?.classList.toggle('coll-view-tab--active', !isGroup)
  viewModeSelect.value = mode
  void renderLinks()
}

viewGroupBtn?.addEventListener('click', () => setCollectionsView('group'))
viewTagBtn?.addEventListener('click', () => setCollectionsView('tag'))

// Mode switch
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

// Bucket toggle (works on all screen sizes)
linkBoard.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const toggle = target.closest<HTMLButtonElement>('[data-bucket-toggle]')
  if (!toggle) return

  const encodedBucketKey = toggle.dataset.bucketKey
  if (!encodedBucketKey) return

  const bucketStateKey = decodeURIComponent(encodedBucketKey)
  const isExpanded = toggle.getAttribute('aria-expanded') === 'true'
  bucketOpenState.set(bucketStateKey, !isExpanded)
  void renderLinks()
})

// Metadata auto-fill
metadataBtn.addEventListener('click', async () => {
  const parsedUrl = toValidUrl(urlInput.value.trim())

  if (!parsedUrl) {
    saveMessage.textContent = 'Enter a valid URL first to fetch metadata.'
    return
  }

  metadataBtn.disabled = true
  metadataBtn.textContent = 'Fetching…'

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
      ? `Metadata applied${extraBits.length ? ` (${extraBits.join(', ')})` : ''}. You can edit before saving.`
      : 'No rich metadata found. Added best-effort tags from domain.'
  } finally {
    metadataBtn.disabled = false
    metadataBtn.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span> Auto Fill'
  }
})

urlInput.addEventListener('blur', () => {
  if (titleInput.value.trim()) return
  const url = toValidUrl(urlInput.value)
  if (!url) return
  titleInput.value = deriveFallbackTitle(url)
})

urlInput.addEventListener('input', () => {
  const parsedUrl = toValidUrl(urlInput.value.trim())
  if (!latestMetadata || !parsedUrl || latestMetadata.url !== parsedUrl) {
    latestMetadata = null
  }
})

// Save link
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
    if (!session) throw new Error('Not authenticated')

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
    saveMessage.textContent = 'Link saved and synced ✓'
  } catch {
    saveMessage.textContent = navigator.onLine
      ? 'Save queued. Sync will retry in background.'
      : 'Offline — link stored locally and queued for sync.'
  }

  await renderLinks()
  void syncPendingLinks()
})

// New Group form
groupForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const name = groupNameInput.value.trim()
  if (!name) return

  // Pre-fill group field in Add Link and open the composer
  groupInput.value = name

  const composerToggle = composerCard.querySelector<HTMLButtonElement>('[data-card-toggle]')
  if (composerToggle?.getAttribute('aria-expanded') === 'false') {
    composerToggle.click()
    // Focus the URL field
    setTimeout(() => urlInput.focus(), 250)
  }

  // Collapse the group card
  const groupToggle = groupCard.querySelector<HTMLButtonElement>('[data-action-toggle]')
  if (groupToggle?.getAttribute('aria-expanded') === 'true') {
    groupToggle.click()
  }

  groupMessage.textContent = `"${name}" ready — add your first link above.`
  groupForm.reset()
})

// PWA install
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event as InstallPromptEvent
  installBtn.hidden = false
})

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return
  await deferredInstallPrompt.prompt()
  const choice = await deferredInstallPrompt.userChoice
  if (choice.outcome === 'accepted') installBtn.hidden = true
  deferredInstallPrompt = null
})

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null
  installBtn.hidden = true
})

// Logout
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

// Collections filters
viewModeSelect.addEventListener('change', () => void renderLinks())
groupFilter.addEventListener('change', () => void renderLinks())
tagFilter.addEventListener('input', () => void renderLinks())

clearFiltersBtn.addEventListener('click', () => {
  groupFilter.value = ''
  tagFilter.value = ''
  void renderLinks()
})

window.addEventListener('online', () => void syncPendingLinks())

// ── Initial boot ─────────────────────────────────────────────────

if (session || offlineOnlyMode) {
  updateGreeting(session?.username ?? null)
  setAuthUi(true)
  modeSwitch.value = offlineOnlyMode ? 'offline' : 'account'
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
  if (pendingSharedPayload) {
    authMessage.textContent = 'Login/register or use Offline Mode to save the shared link.'
  }
}

window.addEventListener('beforeunload', () => {
  cleanupStatus?.()
})
