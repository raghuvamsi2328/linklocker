/**
 * main.ts — BNKR application bootstrap.
 *
 * Architecture:
 *   - Yjs document (y-indexeddb) is the single source of truth for all link/group data.
 *   - Auth is optional: users can use the local vault without an account.
 *   - Phase 4 will add y-webrtc + y-websocket providers here for P2P sync.
 */

import './style.css'
import './styles/login.css'
import './styles/app.css'
import { registerSW } from 'virtual:pwa-register'
import { renderLoginPageHtml } from './pages/LoginPage'
import { renderAppPageHtml } from './pages/AppPage'
import { initVault, switchVault, connectSync, disconnectSync, getSync } from './yjsStore'
import { addLink, updateLink, getLinks, deleteLink } from './data/links'
import { createGroup, getGroups, findOrCreateGroup } from './data/groups'
import { attachSyncStatus } from './syncStatus'
import { authenticate } from './features/authSync'
import { clearAuthCache, updateCachedToken } from './features/offlineAuth'
import { initVaultCrypto, deriveKeyFromCredentials } from './features/vaultCrypto'
import { getDeviceIdentity } from './features/deviceIdentity'
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
  getStoredSession,
  storeSession,
  getStoredOfflineMode,
  setStoredOfflineMode,
  type AppSession
} from './features/sessionMode'
import { applyPendingSharedPayloadToForm } from './features/uiState'

// ── Types ────────────────────────────────────────────────────────

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// ── PWA ──────────────────────────────────────────────────────────

registerSW({ immediate: true })

// ── Yjs vault ────────────────────────────────────────────────────

const _vault = initVault()
let doc = _vault.doc
const { ready: vaultReady } = _vault

// ── App root ─────────────────────────────────────────────────────

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app root element')

app.innerHTML = `
  <main class="page-shell">
    ${renderLoginPageHtml()}
    ${renderAppPageHtml()}
  </main>
`

// ── Element queries ──────────────────────────────────────────────

const syncStatusEl    = document.querySelector<HTMLElement>('#sync-status')!
const authPanel       = document.querySelector<HTMLElement>('#auth-panel')!
const appPanel        = document.querySelector<HTMLElement>('#app-panel')!
const authForm        = document.querySelector<HTMLFormElement>('#auth-form')!
const loginBtn        = document.querySelector<HTMLButtonElement>('#login-btn')!
const registerBtn     = document.querySelector<HTMLButtonElement>('#register-btn')!
const offlineModeBtn  = document.querySelector<HTMLButtonElement>('#offline-mode-btn')!
const authMessage     = document.querySelector<HTMLElement>('#auth-message')!
const installBtn      = document.querySelector<HTMLButtonElement>('#install-btn')!
const landingInstallBtn = document.querySelector<HTMLButtonElement>('#landing-install-btn')!
const logoutBtn       = document.querySelector<HTMLButtonElement>('#logout-btn')!
const linkForm        = document.querySelector<HTMLFormElement>('#link-form')!
const saveMessage     = document.querySelector<HTMLElement>('#save-message')!
const linkBoard       = document.querySelector<HTMLElement>('#link-board')!
const urlInput        = document.querySelector<HTMLInputElement>('#link-url')!
const titleInput      = document.querySelector<HTMLInputElement>('#link-title')!
const groupInput      = document.querySelector<HTMLInputElement>('#link-group')!
const tagsInput       = document.querySelector<HTMLInputElement>('#link-tags')!
const metadataBtn     = document.querySelector<HTMLButtonElement>('#metadata-btn')!
const viewModeSelect  = document.querySelector<HTMLSelectElement>('#view-mode')!
const groupFilter     = document.querySelector<HTMLSelectElement>('#filter-group')!
const tagFilter       = document.querySelector<HTMLInputElement>('#filter-tag')!
const clearFiltersBtn = document.querySelector<HTMLButtonElement>('#clear-filters')!
const groupForm       = document.querySelector<HTMLFormElement>('#group-form')!
const groupNameInput  = document.querySelector<HTMLInputElement>('#group-name')!
const exportBtn       = document.querySelector<HTMLButtonElement>('#export-btn')!
const importFile      = document.querySelector<HTMLInputElement>('#import-file')!
const backupMessage   = document.querySelector<HTMLElement>('#backup-message')!
const deviceIdBtn     = document.querySelector<HTMLButtonElement>('#device-id-btn')!
const actionModal     = document.querySelector<HTMLElement>('#action-modal')!
const modalCloseBtn   = document.querySelector<HTMLButtonElement>('#modal-close')!
const modalTitle      = document.querySelector<HTMLElement>('#modal-title')!

// ── Rotating quotes ───────────────────────────────────────────────

const QUOTES = [
  'Stop digging — you have hit bottom.',
  "Another link you'll never revisit.",
  'Saved for later means forgotten forever.',
  'Your future self will not thank you.',
  "The internet isn't going anywhere. Your attention is.",
  'A bookmark is just a tab with commitment issues.',
  'Collect links, not wisdom.',
  'Every link saved is a promise left unkept.',
  'You already have 47 open tabs. This is fine.',
  'The vault grows. The reading list does not.',
  'Knowledge saved ≠ knowledge gained.',
  "The best time to read it was when you saved it. That was three years ago.",
]

const quoteEl = document.querySelector<HTMLElement>('#rotating-quote')
if (quoteEl) {
  let qi = Math.floor(Math.random() * QUOTES.length)
  quoteEl.textContent = QUOTES[qi]
  setInterval(() => {
    qi = (qi + 1) % QUOTES.length
    if (quoteEl) {
      quoteEl.style.opacity = '0'
      setTimeout(() => {
        if (quoteEl) { quoteEl.textContent = QUOTES[qi]; quoteEl.style.opacity = '1' }
      }, 400)
    }
  }, 7000)
}

// ── App state ─────────────────────────────────────────────────────

let session: AppSession | null = getStoredSession()

const bucketOpenState = new Map<string, boolean>()
let deferredInstallPrompt: InstallPromptEvent | null = null
let latestMetadata: { url: string; description: string; image: string; favicon: string; siteName: string } | null = null
let syncStatus: { cleanup: () => void; update: () => void } | null = null

// ── Greetings in multiple languages ──────────────────────────────

const GREETINGS = [
  'Hello',           // English
  'Hola',            // Spanish
  'Bonjour',         // French
  'Ciao',            // Italian
  'Hallo',           // German
  'Olá',             // Portuguese
  'Привет',          // Russian
  '你好',            // Mandarin Chinese
  'こんにちは',      // Japanese
  '안녕하세요',      // Korean
  'สวัสดี',          // Thai
  'مرحبا',           // Arabic
  'שלום',            // Hebrew
  'Γεια σας',        // Greek
  'Namaste',         // Hindi
  'Sawubona',        // Zulu
  'Terve',           // Finnish
  'Hej',             // Swedish
  'Goedendag',       // Dutch
  'Ahoj',            // Czech
]

const getRandomGreeting = (): string => {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
}

// ── Sync status ──────────────────────────────────────────────────

syncStatus = attachSyncStatus(syncStatusEl, getSync)

// ── Greeting & stats ─────────────────────────────────────────────

const updateGreeting = (username: string | null) => {
  const el = document.querySelector<HTMLElement>('#app-greeting')
  if (el) {
    const greeting = getRandomGreeting()
    el.textContent = username ? `${greeting}, ${username}!` : `${greeting}!`
  }
}

const updateStats = (rows: LinkRow[]) => {
  const statLinks  = document.querySelector<HTMLElement>('#stat-links')
  const statGroups = document.querySelector<HTMLElement>('#stat-groups')
  const statTags   = document.querySelector<HTMLElement>('#stat-tags')
  if (statLinks)  statLinks.textContent  = String(rows.length)
  if (statGroups) statGroups.textContent = String(new Set(rows.map((r) => r.group).filter(Boolean)).size)
  if (statTags)   statTags.textContent   = String(new Set(rows.flatMap((r) => r.tags)).size)
}

// ── Auth UI ───────────────────────────────────────────────────────

const setAuthUi = (loggedIn: boolean) => {
  authPanel.hidden  = loggedIn
  appPanel.hidden   = !loggedIn
  authPanel.style.display = loggedIn ? 'none'   : 'grid'
  appPanel.style.display  = loggedIn ? 'flex'   : 'none'
  if (loggedIn) {
    authMessage.textContent = ''
    authForm.reset()
  }
}

// ── Board render ──────────────────────────────────────────────────

const renderLinks = () => {
  void (async () => {
    const links  = await getLinks(doc)
    const groups = await getGroups(doc)
    const rows   = buildLinkRows(links, groups)
    applyGroupFilterOptions(groupFilter, rows)

    const selectedGroup = groupFilter.value
    const tagNeedle     = tagFilter.value.trim().toLowerCase()
    const mode          = viewModeSelect.value === 'tag' ? 'tag' : 'group'

    linkBoard.innerHTML = renderBoardHtml(rows, selectedGroup, tagNeedle, mode, bucketOpenState)
    updateStats(rows)
  })()
}

// Re-render whenever the vault changes (live reactive updates)
const linksObserver  = () => renderLinks()
const groupsObserver = () => renderLinks()

const attachVaultObservers = (d: typeof doc) => {
  d.getMap('links').observe(linksObserver)
  d.getMap('groups').observe(groupsObserver)
}
const detachVaultObservers = (d: typeof doc) => {
  d.getMap('links').unobserve(linksObserver)
  d.getMap('groups').unobserve(groupsObserver)
}

attachVaultObservers(doc)

// ── Tag helpers ──────────────────────────────────────────────────

const parseTags = (value: string): string[] =>
  value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)

// ── Auth logic ───────────────────────────────────────────────────

const setAuthPending = (pending: boolean) => {
  loginBtn.disabled    = pending
  registerBtn.disabled = pending
  offlineModeBtn.disabled = pending
  const label = loginBtn.querySelector<HTMLElement>('.login-btn-label')
  if (label) label.textContent = pending ? 'Signing in…' : 'Sign In'
}

const runAuth = async (mode: 'login' | 'register') => {
  setAuthPending(true)
  authMessage.textContent = ''
  try {
    const username = (document.querySelector<HTMLInputElement>('#username')?.value ?? '').trim().toLowerCase()
    const password =  document.querySelector<HTMLInputElement>('#password')?.value ?? ''
    const { session: newSession, wasOffline } = await authenticate(mode, username, password)
    session = newSession
    storeSession(newSession)

    // Derive a deterministic vault key from credentials so all devices
    // logged in as the same user can decrypt each other's synced data.
    await deriveKeyFromCredentials(username, password)

    // Switch to a user-specific IndexedDB vault so different accounts are fully isolated
    console.log('[boot] runAuth: switching vault to user:', newSession.username)
    detachVaultObservers(doc)
    doc = await switchVault(newSession.username)
    attachVaultObservers(doc)
    console.log('[boot] runAuth: vault switched, doc guid:', doc.guid)

    // Phase 4: start WebSocket sync for this user's vault
    const provider = connectSync(`bnkr-vault-${newSession.username}`, SYNC_URL)
    provider.on('status', () => syncStatus?.update())
    provider.on('sync',   () => syncStatus?.update())

    updateGreeting(newSession.username)
    setAuthUi(true)
    if (wasOffline) {
      authMessage.textContent = 'Signed in offline using cached credentials.'
    }
    renderLinks()
  } catch (error) {
    const fallback = mode === 'register'
      ? 'Registration requires a network connection.'
      : 'Unable to sign in. Check your connection or credentials.'
    authMessage.textContent = error instanceof Error ? error.message || fallback : fallback
  } finally {
    setAuthPending(false)
  }
}

// ── Login page listeners ──────────────────────────────────────────

authForm.addEventListener('submit', async (e) => { e.preventDefault(); await runAuth('login') })
loginBtn.addEventListener('click',  async (e) => { e.preventDefault(); if (!authForm.reportValidity()) return; await runAuth('login') })
registerBtn.addEventListener('click', async () => { await runAuth('register') })

offlineModeBtn.addEventListener('click', () => {
  setStoredOfflineMode(true)
  setAuthUi(true)
  applyPendingSharedPayloadToForm(parseSharedPayloadFromLocation(window.location, window.history), {
    urlInput, titleInput, saveMessage, openComposer: () => openModal('link')
  })
  renderLinks()
  saveMessage.textContent = 'Running in local-only vault mode.'
})

// Login / Register tab switching
const tabLogin    = document.querySelector<HTMLButtonElement>('#tab-login')
const tabRegister = document.querySelector<HTMLButtonElement>('#tab-register')

const setAuthTab = (mode: 'login' | 'register') => {
  const isLogin = mode === 'login'
  tabLogin?.classList.toggle('login-tab--active', isLogin)
  tabRegister?.classList.toggle('login-tab--active', !isLogin)
  tabLogin?.setAttribute('aria-selected', String(isLogin))
  tabRegister?.setAttribute('aria-selected', String(!isLogin))
  loginBtn.hidden    = !isLogin
  registerBtn.hidden = isLogin
}

tabLogin?.addEventListener('click',    () => setAuthTab('login'))
tabRegister?.addEventListener('click', () => setAuthTab('register'))

// Password visibility toggle
const togglePasswordBtn = document.querySelector<HTMLButtonElement>('#toggle-password')
const eyeIcon           = document.querySelector<HTMLElement>('#eye-icon')
const passwordInput     = document.querySelector<HTMLInputElement>('#password')

togglePasswordBtn?.addEventListener('click', () => {
  if (!passwordInput) return
  const isHidden = passwordInput.type === 'password'
  passwordInput.type = isHidden ? 'text' : 'password'
  if (eyeIcon) eyeIcon.textContent = isHidden ? 'visibility_off' : 'visibility'
  togglePasswordBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password')
})

// ── App page listeners ────────────────────────────────────────────

// Bookmark animation
const bookmarkBtn  = document.querySelector<HTMLButtonElement>('#bookmark-anim')
const bookmarkIcon = bookmarkBtn?.querySelector<HTMLElement>('.bookmark-icon')

const popBookmark = () => {
  if (!bookmarkIcon) return
  bookmarkIcon.classList.remove('is-popping')
  void bookmarkIcon.offsetWidth
  bookmarkIcon.classList.add('is-popping')
}

bookmarkBtn?.addEventListener('click',      popBookmark)
bookmarkBtn?.addEventListener('touchstart', popBookmark, { passive: true })
bookmarkIcon?.addEventListener('animationend', () => bookmarkIcon.classList.remove('is-popping'))

// ── Action modal ─────────────────────────────────────────────────

const MODAL_PANELS: Record<string, { title: string; panelId: string }> = {
  link:   { title: 'Add Link',   panelId: 'modal-link-panel' },
  backup: { title: 'Backup',     panelId: 'modal-backup-panel' },
  group:  { title: 'New Group',  panelId: 'modal-group-panel' },
}

const openModal = (panelKey: string) => {
  const meta = MODAL_PANELS[panelKey]
  if (!meta) return
  for (const p of actionModal.querySelectorAll<HTMLElement>('.modal-panel')) p.hidden = true
  const panel = document.getElementById(meta.panelId)
  if (panel) panel.hidden = false
  modalTitle.textContent = meta.title
  actionModal.hidden = false
  document.body.style.overflow = 'hidden'
  setTimeout(() => panel?.querySelector<HTMLElement>('input')?.focus(), 80)
}

const closeModal = () => {
  actionModal.hidden = true
  document.body.style.overflow = ''
}

for (const card of appPanel.querySelectorAll<HTMLElement>('[data-opens-panel]')) {
  card.addEventListener('click', () => { openModal(card.dataset.opensPanel ?? '') })
}

modalCloseBtn.addEventListener('click', closeModal)
actionModal.addEventListener('click', (e) => { if (e.target === actionModal) closeModal() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !actionModal.hidden) closeModal() })

// Collections view tabs
const viewGroupBtn = document.querySelector<HTMLButtonElement>('#view-group-btn')
const viewTagBtn   = document.querySelector<HTMLButtonElement>('#view-tag-btn')

const setCollectionsView = (mode: 'group' | 'tag') => {
  viewGroupBtn?.classList.toggle('coll-view-tab--active', mode === 'group')
  viewTagBtn?.classList.toggle('coll-view-tab--active',  mode === 'tag')
  viewModeSelect.value = mode
  renderLinks()
}

viewGroupBtn?.addEventListener('click', () => setCollectionsView('group'))
viewTagBtn?.addEventListener('click',   () => setCollectionsView('tag'))

// Bucket toggle
linkBoard.addEventListener('click', (event) => {
  const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-bucket-toggle]')
  if (!toggle) return
  const encoded = toggle.dataset.bucketKey
  if (!encoded) return
  const key      = decodeURIComponent(encoded)
  const isOpen   = toggle.getAttribute('aria-expanded') === 'true'
  bucketOpenState.set(key, !isOpen)
  renderLinks()
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
    const meta = await detectMetadata(parsedUrl)
    latestMetadata = { url: parsedUrl, description: meta.description, image: meta.image, favicon: meta.favicon, siteName: meta.siteName }
    if (meta.title && (!titleInput.value.trim() || isUrlLike(titleInput.value.trim()))) {
      titleInput.value = meta.title
    }
    const merged = [...new Set([...parseTags(tagsInput.value), ...meta.tags])]
    tagsInput.value = merged.join(', ')
    const extras = [
      meta.siteName   ? `site: ${meta.siteName}` : '',
      meta.description ? 'description'            : '',
      meta.image       ? 'image'                  : ''
    ].filter(Boolean)
    saveMessage.textContent = meta.title
      ? `Metadata applied${extras.length ? ` (${extras.join(', ')})` : ''}.`
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
  const parsed = toValidUrl(urlInput.value.trim())
  if (!latestMetadata || !parsed || latestMetadata.url !== parsed) latestMetadata = null
})

// Save link — writes directly to the Yjs vault
linkForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const url       = toValidUrl(urlInput.value.trim())
  const title     = titleInput.value.trim()
  const groupName = groupInput.value.trim()
  const tags      = parseTags(tagsInput.value)

  if (!url) {
    saveMessage.textContent = 'URL is required'
    return
  }

  const group = groupName ? await findOrCreateGroup(doc, groupName) : null
  const meta  = latestMetadata?.url === url ? latestMetadata : null

  const saved = await addLink(doc, {
    url,
    title: title || deriveFallbackTitle(url),
    groupId:     group?.id ?? '',
    tags,
    description: meta?.description,
    image:       meta?.image,
    favicon:     meta?.favicon,
    siteName:    meta?.siteName
  })

  // If Auto Fill wasn't used, background-fetch metadata so the card gets an image
  if (!meta) {
    detectMetadata(url).then(async (m) => {
      const patch: Partial<{ title: string; description: string; image: string; favicon: string; siteName: string }> = {}
      if (m.title && isUrlLike(saved.title)) patch.title = m.title
      if (m.description) patch.description = m.description
      if (m.image)       patch.image       = m.image
      if (m.favicon)     patch.favicon     = m.favicon
      if (m.siteName)    patch.siteName    = m.siteName
      if (Object.keys(patch).length) await updateLink(doc, saved.id, patch)
    }).catch(() => {})
  }

  urlInput.value   = ''
  titleInput.value = ''
  groupInput.value = ''
  tagsInput.value  = ''
  latestMetadata   = null

  saveMessage.textContent = 'Link saved to vault ✓'
  setTimeout(() => { saveMessage.textContent = '' }, 2500)
})

// New Group form
groupForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const name = groupNameInput.value.trim()
  if (!name) return

  await createGroup(doc, name)

  // Pre-fill group in link modal and switch to it
  groupInput.value = name
  groupForm.reset()
  closeModal()
  openModal('link')
  setTimeout(() => urlInput.focus(), 150)
})

// PWA install
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event as InstallPromptEvent
  installBtn.hidden = false
  landingInstallBtn.hidden = false
})

landingInstallBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return
  await deferredInstallPrompt.prompt()
  const choice = await deferredInstallPrompt.userChoice
  if (choice.outcome === 'accepted') {
    landingInstallBtn.hidden = true
    installBtn.hidden = true
  }
  deferredInstallPrompt = null
})

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return
  await deferredInstallPrompt.prompt()
  const choice = await deferredInstallPrompt.userChoice
  if (choice.outcome === 'accepted') {
    installBtn.hidden = true
    landingInstallBtn.hidden = true
  }
  deferredInstallPrompt = null
})

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null
  installBtn.hidden = true
  landingInstallBtn.hidden = true
})

// Logout — clear session, credential cache, offline mode, and WebRTC connection
logoutBtn.addEventListener('click', () => {
  session = null
  clearStoredSession()
  setStoredOfflineMode(false)
  clearAuthCache().catch(() => {})
  disconnectSync()
  syncStatus?.update()
  setAuthUi(false)
})

// Refresh-on-reconnect: when the network comes back, try to get a fresh JWT
// so the cached token stays valid for future offline sessions.
window.addEventListener('online', () => {
  if (!session) return
  fetch('/api/health')
    .then((r) => {
      if (!r.ok) return
      updateCachedToken(session!.username, session!.token).catch(() => {})
    })
    .catch(() => {})
})

// ── Delete link (event delegation on the board) ───────────────────

linkBoard.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-id]')
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()
  const id = btn.dataset.deleteId
  if (!id) return
  deleteLink(doc, id)
})

// ── Export vault ──────────────────────────────────────────────────

exportBtn.addEventListener('click', async () => {
  const links  = await getLinks(doc)
  const groups = await getGroups(doc)
  const payload = JSON.stringify({ version: 1, links, groups }, null, 2)
  const blob    = new Blob([payload], { type: 'application/json' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href        = url
  a.download    = `bnkr-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  backupMessage.textContent = 'Vault exported successfully.'
  setTimeout(() => { backupMessage.textContent = '' }, 3000)
})

// ── Import vault ──────────────────────────────────────────────────

importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0]
  if (!file) return
  importFile.value = ''

  try {
    const text    = await file.text()
    const parsed  = JSON.parse(text) as { version?: number; links?: unknown[]; groups?: unknown[] }

    if (!Array.isArray(parsed.links)) {
      backupMessage.textContent = 'Invalid backup file — missing links array.'
      return
    }

    // Import groups first (links reference group IDs)
    const groupIdMap = new Map<string, string>() // old id → new id
    for (const g of (parsed.groups ?? []) as Array<Record<string, unknown>>) {
      if (typeof g.name !== 'string') continue
      const created = await createGroup(doc, String(g.name), {
        color: typeof g.color === 'string' ? g.color : undefined,
        emoji: typeof g.emoji === 'string' ? g.emoji : undefined
      })
      if (typeof g.id === 'string') groupIdMap.set(g.id, created.id)
    }

    let imported = 0
    for (const l of parsed.links as Array<Record<string, unknown>>) {
      if (typeof l.url !== 'string') continue
      const oldGroupId = typeof l.groupId === 'string' ? l.groupId : ''
      await addLink(doc, {
        url:         String(l.url),
        title:       typeof l.title === 'string' ? l.title : '',
        groupId:     groupIdMap.get(oldGroupId) ?? '',
        tags:        Array.isArray(l.tags) ? (l.tags as string[]).filter((t) => typeof t === 'string') : [],
        description: typeof l.description === 'string' ? l.description : undefined,
        image:       typeof l.image       === 'string' ? l.image       : undefined,
        favicon:     typeof l.favicon     === 'string' ? l.favicon     : undefined,
        siteName:    typeof l.siteName    === 'string' ? l.siteName    : undefined
      })
      imported++
    }

    backupMessage.textContent = `Imported ${imported} link${imported === 1 ? '' : 's'} successfully.`
    setTimeout(() => { backupMessage.textContent = '' }, 4000)
  } catch {
    backupMessage.textContent = 'Import failed — file could not be parsed.'
  }
})

// ── Device ID: click to copy pairing code ────────────────────────

deviceIdBtn.addEventListener('click', async () => {
  const identity = await getDeviceIdentity()
  try {
    await navigator.clipboard.writeText(identity.deviceId)
    const codeEl = document.querySelector<HTMLElement>('#device-pairing-code')
    if (codeEl) {
      const prev = codeEl.textContent
      codeEl.textContent = 'Copied!'
      setTimeout(() => { codeEl.textContent = prev }, 1500)
    }
  } catch { /* clipboard not available */ }
})

// ── Periodic WebRTC peer count refresh ───────────────────────────

setInterval(() => { syncStatus?.update() }, 5000)

// Collection filters
viewModeSelect.addEventListener('change', () => renderLinks())
groupFilter.addEventListener('change',    () => renderLinks())
tagFilter.addEventListener('input',       () => renderLinks())

clearFiltersBtn.addEventListener('click', () => {
  groupFilter.value = ''
  tagFilter.value   = ''
  renderLinks()
})

// ── Boot sequence ─────────────────────────────────────────────────

const SYNC_URL = import.meta.env.VITE_SYNC_URL as string | undefined
  ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`

const boot = async () => {
  // Phase 3: load or create the device vault key
  await initVaultCrypto()

  // Phase 2.5: load or generate device ECDH identity + show pairing code
  const identity = await getDeviceIdentity()
  const pairingCodeEl = document.querySelector<HTMLElement>('#device-pairing-code')
  if (pairingCodeEl) pairingCodeEl.textContent = identity.pairingCode

  // Wait for Yjs to replay persisted vault from IndexedDB
  await vaultReady

  const pendingPayload = parseSharedPayloadFromLocation(window.location, window.history)
  const isOfflineMode = getStoredOfflineMode()

  if (session || isOfflineMode) {
    // Switch to user-specific vault so this account is fully isolated from others on this device
    if (session) {
      console.log('[boot] boot: switching vault to user:', session.username)
      detachVaultObservers(doc)
      doc = await switchVault(session.username)
      attachVaultObservers(doc)
      console.log('[boot] boot: vault switched, doc guid:', doc.guid)

      // Phase 4: connect WebRTC for live P2P sync with other devices logged in as same user
      const provider = connectSync(`bnkr-vault-${session.username}`, SYNC_URL)
      provider.on('status', () => syncStatus?.update())
      provider.on('sync',   () => syncStatus?.update())
    }

    // Seed starter groups for brand-new user vaults (or offline mode)
    const [seedLinks, seedGroups] = await Promise.all([getLinks(doc), getGroups(doc)])
    if (seedLinks.length === 0 && seedGroups.length === 0) {
      await createGroup(doc, 'Reading List')
      await createGroup(doc, 'Resources')
      await createGroup(doc, 'Tools')
      await createGroup(doc, 'Inspiration')
    }

    if (session) {
      updateGreeting(session.username)
    } else if (isOfflineMode) {
      updateGreeting(null) // Show generic greeting in offline mode
    }
    setAuthUi(true)
    applyPendingSharedPayloadToForm(pendingPayload, {
      urlInput, titleInput, saveMessage, openComposer: () => openModal('link')
    })
    renderLinks()
  } else {
    // Seed starter groups for anonymous vault
    const [seedLinks, seedGroups] = await Promise.all([getLinks(doc), getGroups(doc)])
    if (seedLinks.length === 0 && seedGroups.length === 0) {
      await createGroup(doc, 'Reading List')
      await createGroup(doc, 'Resources')
      await createGroup(doc, 'Tools')
      await createGroup(doc, 'Inspiration')
    }

    setAuthUi(false)
    if (pendingPayload) {
      authMessage.textContent = 'Login or tap "Continue without account" to save the shared link.'
    }
  }
}

void boot()

window.addEventListener('beforeunload', () => { syncStatus?.cleanup() })
