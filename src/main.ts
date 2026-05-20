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
import { createGroup, getGroups } from './data/groups'
import { attachSyncStatus } from './syncStatus'
import { authenticate, registerDeviceWithServer, verifyPairingCode } from './features/authSync'
import { clearAuthCache, updateCachedToken } from './features/offlineAuth'
import { initVaultCrypto, deriveKeyFromCredentials } from './features/vaultCrypto'
import { getDeviceIdentity } from './features/deviceIdentity'
import { applyGroupFilterOptions, buildLinkRows, renderBoardHtml } from './features/board'
import { renderHomeGroups, renderHomeRecentLinks, renderHomeRecentVisitedLinks } from './features/homePreview'
import { getRecentVisitedLinks, trackRecentVisit } from './features/recentVisits'
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
  getStoredOfflineDisplayName,
  getStoredOfflineMode,
  setStoredOfflineDisplayName,
  setStoredOfflineMode,
  type AppSession
} from './features/sessionMode'
import { applyPendingSharedPayloadToForm } from './features/uiState'
import { initProductivityFeature } from './features/productivity'

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

  <!-- Device pairing overlay — shown when a second device logs in -->
  <div id="pairing-overlay" class="pairing-overlay" hidden aria-modal="true" role="dialog" aria-labelledby="pairing-title">
    <div class="pairing-sheet">
      <span class="material-symbols-rounded pairing-icon" aria-hidden="true">devices</span>
      <h2 class="pairing-title" id="pairing-title">New device detected</h2>
      <p class="pairing-desc">Enter the 4-character pairing code shown in <strong>Settings → Pairing Code</strong> on one of your trusted devices.</p>
      <input
        id="pairing-code-input"
        class="pairing-input"
        type="text"
        maxlength="4"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        placeholder="A3F1"
        aria-label="Pairing code"
      />
      <p id="pairing-error" class="pairing-error" hidden></p>
      <button id="pairing-submit-btn" type="button" class="pairing-submit-btn">
        <span class="material-symbols-rounded" aria-hidden="true">link</span>
        Pair device
      </button>
      <button id="pairing-cancel-btn" type="button" class="pairing-cancel-btn">Cancel — sign out</button>
    </div>
  </div>

  <div id="move-group-overlay" class="move-group-overlay" hidden>
    <div class="move-group-sheet" role="dialog" aria-modal="true" aria-labelledby="move-group-title">
      <div class="move-group-head">
        <h3 id="move-group-title" class="move-group-title">Move Link To</h3>
        <button id="move-group-close" type="button" class="move-group-close" aria-label="Close move group picker">
          <span class="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
      </div>
      <div id="move-group-options" class="move-group-options"></div>
      <button id="move-group-cancel" type="button" class="move-group-cancel">Cancel</button>
    </div>
  </div>

  <div id="offline-name-overlay" class="offline-name-overlay" hidden>
    <div class="offline-name-sheet" role="dialog" aria-modal="true" aria-labelledby="offline-name-title">
      <h3 id="offline-name-title" class="offline-name-title">How should we call you?</h3>
      <p class="offline-name-copy">This name is only used locally for greetings in offline mode.</p>
      <input
        id="offline-name-input"
        class="offline-name-input"
        type="text"
        maxlength="32"
        placeholder="Your name"
        autocomplete="nickname"
      />
      <p id="offline-name-error" class="offline-name-error" hidden></p>
      <div class="offline-name-actions">
        <button id="offline-name-cancel" type="button" class="offline-name-btn offline-name-btn--ghost">Cancel</button>
        <button id="offline-name-continue" type="button" class="offline-name-btn offline-name-btn--primary">Continue Offline</button>
      </div>
    </div>
  </div>
`

// ── Element queries ──────────────────────────────────────────────

const syncStatusEl    = document.querySelector<HTMLElement>('#sync-status')
const authPanel       = document.querySelector<HTMLElement>('#auth-panel')!
const appPanel        = document.querySelector<HTMLElement>('#app-panel')!
const authForm        = document.querySelector<HTMLFormElement>('#auth-form')!
const loginBtn        = document.querySelector<HTMLButtonElement>('#login-btn')!
const registerBtn     = document.querySelector<HTMLButtonElement>('#register-btn')!
const offlineModeBtn  = document.querySelector<HTMLButtonElement>('#offline-mode-btn')!
const authMessage     = document.querySelector<HTMLElement>('#auth-message')!
const landingInstallBtn = document.querySelector<HTMLButtonElement>('#landing-install-btn')!
const settingsInstallBtn = document.querySelector<HTMLButtonElement>('#settings-install-btn')
const logoutBtn       = document.querySelector<HTMLButtonElement>('#logout-btn')!
const linkForm        = document.querySelector<HTMLFormElement>('#link-form')!
const saveMessage     = document.querySelector<HTMLElement>('#save-message')!
const linkBoard       = document.querySelector<HTMLElement>('#link-board')!
const urlInput        = document.querySelector<HTMLInputElement>('#link-url')!
const titleInput      = document.querySelector<HTMLInputElement>('#link-title')!
const groupInput      = document.querySelector<HTMLSelectElement>('#link-group')!
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
const bottomNav       = document.querySelector<HTMLElement>('#bottom-nav')
const tabPanels       = [...document.querySelectorAll<HTMLElement>('[data-tab-panel]')]
const homeEmptyState  = document.querySelector<HTMLElement>('#home-empty-state')
const homeQuickActions = document.querySelector<HTMLElement>('#home-quick-actions')
const homeQuote = document.querySelector<HTMLElement>('#home-quote')
const homePreview = document.querySelector<HTMLElement>('#home-preview')
const homeGroupsPreview = document.querySelector<HTMLElement>('#home-groups-preview')
const homeRecentPreview = document.querySelector<HTMLElement>('#home-recent-preview')
const homeRecentVisitedPreview = document.querySelector<HTMLElement>('#home-recent-visited-preview')
const moveGroupOverlay = document.querySelector<HTMLElement>('#move-group-overlay')!
const moveGroupOptions = document.querySelector<HTMLElement>('#move-group-options')!
const moveGroupCloseBtn = document.querySelector<HTMLButtonElement>('#move-group-close')!
const moveGroupCancelBtn = document.querySelector<HTMLButtonElement>('#move-group-cancel')!
const offlineNameOverlay = document.querySelector<HTMLElement>('#offline-name-overlay')!
const offlineNameInput = document.querySelector<HTMLInputElement>('#offline-name-input')!
const offlineNameError = document.querySelector<HTMLElement>('#offline-name-error')!
const offlineNameCancelBtn = document.querySelector<HTMLButtonElement>('#offline-name-cancel')!
const offlineNameContinueBtn = document.querySelector<HTMLButtonElement>('#offline-name-continue')!

const CREATE_GROUP_OPTION_VALUE = '__create_group__'
const MOVE_GROUP_NONE_VALUE = '__none__'

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
let currentGreetingUser: string | null = null
let greetingRefreshTimer: number | null = null
let hapticAudioContext: AudioContext | null = null

const playFallbackTapFeedback = () => {
  const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return

  hapticAudioContext ??= new AudioCtx()
  const ctx = hapticAudioContext

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }

  const now = ctx.currentTime
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(160, now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.0015, now + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)

  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.03)
}

const vibrateShort = () => {
  if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
    const didVibrate = navigator.vibrate(10)
    if (didVibrate) return
  }

  playFallbackTapFeedback()
}

initProductivityFeature({ vibrate: vibrateShort })

// ── Time-based greeting ─────────────────────────────────────────

type GreetingVariant = {
  withName: (name: string, now: Date) => string
  withoutName: (now: Date) => string
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const GREETING_VARIANTS: Record<'lateNight' | 'freshMorning' | 'standardDay' | 'windDown', GreetingVariant[]> = {
  lateNight: [
    {
      withName: (name) => `Burning the midnight oil, ${name}? 🦉`,
      withoutName: () => 'Burning the midnight oil? 🦉'
    },
    {
      withName: (name) => `Should you not be asleep right now, ${name}?`,
      withoutName: () => 'Should you not be asleep right now?'
    },
    {
      withName: (name) => `${name}, up late or up early?`,
      withoutName: () => 'Up late or up early?'
    },
    {
      withName: (name) => `Midnight mode activated. Welcome back, ${name}.`,
      withoutName: () => 'Midnight mode activated. Welcome back.'
    }
  ],
  freshMorning: [
    {
      withName: (name) => `Rise and grind, ${name}. ☕`,
      withoutName: () => 'Rise and grind. ☕'
    },
    {
      withName: (name) => `The early bird gets the code, ${name}.`,
      withoutName: () => 'The early bird gets the code.'
    },
    {
      withName: (name) => `Morning, ${name}! Fresh start.`,
      withoutName: () => 'Morning! Fresh start.'
    }
  ],
  standardDay: [
    {
      withName: (name, now) => `Happy ${WEEKDAY[now.getDay()]}, ${name}! Let us get it.`,
      withoutName: (now) => `Happy ${WEEKDAY[now.getDay()]}! Let us get it.`
    },
    {
      withName: (name) => `Crushing it today, ${name}?`,
      withoutName: () => 'Crushing it today?'
    },
    {
      withName: (name) => `Midday momentum, ${name}.`,
      withoutName: () => 'Midday momentum.'
    }
  ],
  windDown: [
    {
      withName: (name) => `Time to unwind, ${name}. 🌅`,
      withoutName: () => 'Time to unwind. 🌅'
    },
    {
      withName: (name) => `Cheers to the evening, ${name}.`,
      withoutName: () => 'Cheers to the evening.'
    },
    {
      withName: (name) => `Late night vibes, ${name}. 🌙`,
      withoutName: () => 'Late night vibes. 🌙'
    }
  ]
}

const pickGreeting = <T>(choices: readonly T[], now: Date): T => {
  // Keep one stable funny greeting per hour to avoid flicker.
  const daySeed = Math.floor(now.getTime() / 86_400_000)
  const index = Math.abs(daySeed + now.getHours()) % choices.length
  return choices[index]
}

const getGreetingText = (username: string | null): string => {
  const now = new Date()
  const hour = now.getHours()

  const variantSet =
    hour < 5
      ? GREETING_VARIANTS.lateNight
      : hour < 9
        ? GREETING_VARIANTS.freshMorning
        : hour < 17
          ? GREETING_VARIANTS.standardDay
          : GREETING_VARIANTS.windDown

  const variant = pickGreeting(variantSet, now)
  const trimmedName = (username ?? '').trim()

  if (!trimmedName) return variant.withoutName(now)

  const withName = variant.withName(trimmedName, now)
  const maxLength = window.innerWidth <= 480 ? 36 : 54
  if (trimmedName.length > 14 || withName.length > maxLength) return variant.withoutName(now)
  return withName
}

// ── Sync status ──────────────────────────────────────────────────

if (syncStatusEl) {
  syncStatus = attachSyncStatus(syncStatusEl, getSync)
}

// ── Greeting & stats ─────────────────────────────────────────────

const updateGreeting = (username: string | null) => {
  currentGreetingUser = username
  const el = document.querySelector<HTMLElement>('#app-greeting')
  if (el) {
    el.textContent = getGreetingText(username)
  }

  const heroKicker = document.querySelector<HTMLElement>('#home-hero-kicker')
  if (heroKicker) {
    const trimmedName = (username ?? '').trim()
    heroKicker.textContent = trimmedName ? `Hi ${trimmedName},` : 'Hi there,'
  }
}

const scheduleGreetingRefresh = () => {
  if (greetingRefreshTimer !== null) window.clearTimeout(greetingRefreshTimer)

  const now = new Date()
  const next = new Date(now)
  const hour = now.getHours()

  // Refresh at greeting boundaries: 00:00, 05:00, 09:00, 17:00
  if (hour < 5) next.setHours(5, 0, 0, 0)
  else if (hour < 9) next.setHours(9, 0, 0, 0)
  else if (hour < 17) next.setHours(17, 0, 0, 0)
  else {
    next.setDate(next.getDate() + 1)
    next.setHours(0, 0, 0, 0)
  }

  const delayMs = Math.max(1000, next.getTime() - now.getTime())
  greetingRefreshTimer = window.setTimeout(() => {
    updateGreeting(currentGreetingUser)
    scheduleGreetingRefresh()
  }, delayMs)
}

scheduleGreetingRefresh()

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

const applyLinkGroupOptions = async () => {
  const groups = await getGroups(doc)
  const current = groupInput.value
  groupInput.innerHTML = '<option value="">No Group</option>'

  for (const group of groups) {
    const option = document.createElement('option')
    option.value = group.id
    option.textContent = `${group.emoji} ${group.name}`
    groupInput.append(option)
  }

  const createOption = document.createElement('option')
  createOption.value = CREATE_GROUP_OPTION_VALUE
  createOption.textContent = '+ Create new group'
  groupInput.append(createOption)

  if (current && groups.some((group) => group.id === current)) {
    groupInput.value = current
  } else {
    groupInput.value = ''
  }
}

let moveGroupResolve: ((value: string | null) => void) | null = null

const closeMoveGroupSheet = (value: string | null) => {
  if (moveGroupOverlay.hidden) return
  moveGroupOverlay.hidden = true
  document.body.style.overflow = ''
  const resolve = moveGroupResolve
  moveGroupResolve = null
  if (resolve) resolve(value)
}

const openMoveGroupSheet = async (currentGroupId: string): Promise<string | null> => {
  const groups = await getGroups(doc)
  const options = [
    { id: MOVE_GROUP_NONE_VALUE, label: 'No Group', emoji: '📎' },
    ...groups.map((group) => ({ id: group.id, label: group.name, emoji: group.emoji }))
  ]

  moveGroupOptions.innerHTML = options.map((option) => {
    const isCurrent = (option.id === MOVE_GROUP_NONE_VALUE && !currentGroupId) || option.id === currentGroupId
    return `
      <button type="button" class="move-group-option${isCurrent ? ' is-current' : ''}" data-move-group-id="${option.id}">
        <span class="move-group-option-emoji">${option.emoji}</span>
        <span class="move-group-option-label">${option.label}</span>
        ${isCurrent ? '<span class="move-group-option-current">Current</span>' : ''}
      </button>`
  }).join('')

  moveGroupOverlay.hidden = false
  document.body.style.overflow = 'hidden'

  return new Promise<string | null>((resolve) => {
    moveGroupResolve = resolve
  })
}

const renderLinks = () => {
  void (async () => {
    const links  = await getLinks(doc)
    const groups = await getGroups(doc)
    const rows   = buildLinkRows(links, groups)
    applyGroupFilterOptions(groupFilter, rows)
    await applyLinkGroupOptions()

    const selectedGroup = groupFilter.value
    const tagNeedle     = tagFilter.value.trim().toLowerCase()
    const mode          = viewModeSelect.value === 'tag' ? 'tag' : 'group'
    const isEmptyVault  = links.length === 0  // Check total links, not filtered rows

    if (homeEmptyState) homeEmptyState.hidden = !isEmptyVault
    if (homeQuickActions) homeQuickActions.hidden = isEmptyVault
    if (homePreview) homePreview.hidden = false
    if (homeQuote) homeQuote.hidden = isEmptyVault

    const visitScope = session?.username ?? getStoredOfflineDisplayName() ?? 'offline'
    const recentVisitedLinks = getRecentVisitedLinks(visitScope, links)

    if (homeGroupsPreview) homeGroupsPreview.innerHTML = renderHomeGroups(groups, links)
    if (homeRecentPreview) homeRecentPreview.innerHTML = renderHomeRecentLinks(links)
    if (homeRecentVisitedPreview) homeRecentVisitedPreview.innerHTML = renderHomeRecentVisitedLinks(recentVisitedLinks)

    linkBoard.innerHTML = renderBoardHtml(rows, selectedGroup, tagNeedle, mode, bucketOpenState)
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

// ── Device pairing overlay ────────────────────────────────────────

/**
 * Shows the pairing overlay and returns a Promise that resolves only after
 * the user successfully enters the code from a trusted device.
 * If the user cancels, the session is cleared and the login screen is shown.
 */
const showPairingOverlay = (token: string, deviceId: string): Promise<boolean> =>
  new Promise((resolve) => {
    const overlay   = document.getElementById('pairing-overlay')!
    const input     = document.getElementById('pairing-code-input') as HTMLInputElement
    const errorEl   = document.getElementById('pairing-error')!
    const submitBtn = document.getElementById('pairing-submit-btn') as HTMLButtonElement
    const cancelBtn = document.getElementById('pairing-cancel-btn') as HTMLButtonElement

    overlay.hidden = false
    input.value = ''
    errorEl.hidden = true
    setTimeout(() => input.focus(), 80)

    const cleanup = () => { overlay.hidden = true }

    const onSubmit = async () => {
      const code = input.value.trim().toUpperCase()
      if (code.length !== 4) {
        errorEl.textContent = 'Enter a 4-character code.'
        errorEl.hidden = false
        return
      }
      submitBtn.disabled = true
      submitBtn.textContent = 'Verifying…'
      errorEl.hidden = true
      try {
        await verifyPairingCode(token, deviceId, code)
        cleanup()
        resolve(true)
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : 'Invalid pairing code.'
        errorEl.hidden = false
        submitBtn.disabled = false
        submitBtn.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">link</span> Pair device'
      }
    }

    const onCancel = () => {
      cleanup()
      session = null
      clearStoredSession()
      setAuthUi(false)
      // Cancel pairing and return to login.
      resolve(false)
    }

    submitBtn.onclick = onSubmit
    cancelBtn.onclick = onCancel
    input.onkeydown = (e) => { if (e.key === 'Enter') void onSubmit() }
    // Auto-uppercase as user types
    input.oninput = () => { input.value = input.value.toUpperCase() }
  })

const ensureTrustedDeviceOrAbort = async (
  token: string,
  identity: { deviceId: string; pairingCode: string },
  interactive: boolean
): Promise<boolean> => {
  try {
    const status = await registerDeviceWithServer(token, identity.deviceId, identity.pairingCode)
    if (status.isTrusted) return true
    if (!interactive) return false
    return showPairingOverlay(token, identity.deviceId)
  } catch {
    // If server is unreachable, allow local use and skip trust checks.
    return true
  }
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

    // Phase 4: start WebSocket sync for this user's vault — auth params gate access
    const identity = await getDeviceIdentity()

    const trusted = await ensureTrustedDeviceOrAbort(newSession.token, identity, true)
    if (!trusted) {
      // User cancelled pairing. Stay signed out and do not connect sync.
      setAuthPending(false)
      return
    }

    const provider = connectSync(
      `bnkr-vault-${newSession.username}`,
      SYNC_URL,
      { token: newSession.token, deviceId: identity.deviceId }
    )
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
  openOfflineNameSheet()
})

// Login / Register tab switching
const tabLogin    = document.querySelector<HTMLButtonElement>('#tab-login')
const tabRegister = document.querySelector<HTMLButtonElement>('#tab-register')
const authModeKicker = document.querySelector<HTMLElement>('#auth-mode-kicker')
const authModeTitle = document.querySelector<HTMLElement>('#auth-mode-title')
const authModeSubtitle = document.querySelector<HTMLElement>('#auth-mode-subtitle')
const passwordHint = document.querySelector<HTMLElement>('#password-hint')

const setAuthTab = (mode: 'login' | 'register') => {
  const isLogin = mode === 'login'
  tabLogin?.classList.toggle('login-tab--active', isLogin)
  tabRegister?.classList.toggle('login-tab--active', !isLogin)
  tabLogin?.setAttribute('aria-selected', String(isLogin))
  tabRegister?.setAttribute('aria-selected', String(!isLogin))
  loginBtn.hidden    = !isLogin
  registerBtn.hidden = isLogin

  if (passwordInput) {
    passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password'
  }

  if (authModeKicker) {
    authModeKicker.textContent = isLogin ? 'Welcome back' : 'Create account'
  }

  if (authModeTitle) {
    authModeTitle.textContent = isLogin ? 'Sign in to your vault' : 'Create your secure vault'
  }

  if (authModeSubtitle) {
    authModeSubtitle.textContent = isLogin
      ? 'Use your username and password to decrypt and sync your links.'
      : 'Your credentials derive your vault key. Use something memorable and secure.'
  }

  if (passwordHint) {
    passwordHint.textContent = isLogin
      ? 'Minimum 6 characters.'
      : 'Choose at least 6 characters. This password unlocks your encrypted vault.'
  }

  authMessage.textContent = ''
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

// Bottom navigation
const setActiveTab = (tabName: string) => {
  for (const panel of tabPanels) {
    panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName)
  }
  for (const tab of bottomNav?.querySelectorAll<HTMLButtonElement>('.bottom-nav-tab') ?? []) {
    tab.classList.toggle('is-active', tab.dataset.tab === tabName)
  }
}

for (const tab of bottomNav?.querySelectorAll<HTMLButtonElement>('.bottom-nav-tab') ?? []) {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab ?? 'home'
    // When navigating to collections tab, clear filters to show all links
    if (tabName === 'collections') {
      groupFilter.value = ''
      tagFilter.value = ''
      renderLinks()
    }
    setActiveTab(tabName)
    vibrateShort()
  })
}

setActiveTab('home')

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
  vibrateShort()
  setTimeout(() => panel?.querySelector<HTMLElement>('input')?.focus(), 80)
}

const closeModal = () => {
  actionModal.hidden = true
  document.body.style.overflow = ''
}

const isStandaloneShell = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)

const openExternalUrl = (url: string) => {
  const popup = window.open(url, '_blank', 'noopener,noreferrer')
  if (!popup) window.location.href = url
}

for (const card of appPanel.querySelectorAll<HTMLElement>('[data-opens-panel]')) {
  card.addEventListener('click', () => { openModal(card.dataset.opensPanel ?? '') })
}

appPanel.addEventListener('click', (event) => {
  const externalLink = (event.target as HTMLElement).closest<HTMLAnchorElement>('[data-external-link]')
  if (externalLink) {
    const linkId = externalLink.dataset.linkId ?? ''
    if (linkId) {
      const visitScope = session?.username ?? getStoredOfflineDisplayName() ?? 'offline'
      trackRecentVisit(visitScope, linkId)
      if (homeRecentVisitedPreview && homePreview && !homePreview.hidden) renderLinks()
    }
    if (!isStandaloneShell()) return
    event.preventDefault()
    openExternalUrl(externalLink.href)
    return
  }

  const openCollectionsBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-home-open-collections]')
  if (openCollectionsBtn) {
    event.preventDefault()
    groupFilter.value = ''  // Clear group filter to show all links
    tagFilter.value = ''    // Clear tag filter as well
    setActiveTab('collections')
    renderLinks()
    return
  }

  const openAddToolsBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-home-open-add]')
  if (openAddToolsBtn) {
    event.preventDefault()
    setActiveTab('add')
    return
  }

  const homeGroupBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-home-group-name]')
  if (homeGroupBtn) {
    event.preventDefault()
    const groupId = homeGroupBtn.dataset.homeGroupName ?? ''
    if (groupId === '__ungrouped') {
      groupFilter.value = ''
    } else {
      const groupName = homeGroupBtn.querySelector<HTMLElement>('.home-group-chip-name')?.textContent ?? ''
      groupFilter.value = groupName
    }
    setActiveTab('collections')
    renderLinks()
    return
  }

  const addBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-home-add]')
  if (addBtn) {
    event.preventDefault()
    openModal('link')
    return
  }

  const groupBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-home-group]')
  if (groupBtn) {
    event.preventDefault()
    openModal('group')
  }
})

modalCloseBtn.addEventListener('click', closeModal)
actionModal.addEventListener('click', (e) => { if (e.target === actionModal) closeModal() })
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!actionModal.hidden) closeModal()
  if (!offlineNameOverlay.hidden) closeOfflineNameSheet()
})

moveGroupCloseBtn.addEventListener('click', () => closeMoveGroupSheet(null))
moveGroupCancelBtn.addEventListener('click', () => closeMoveGroupSheet(null))
moveGroupOverlay.addEventListener('click', (event) => {
  if (event.target === moveGroupOverlay) closeMoveGroupSheet(null)
})

moveGroupOptions.addEventListener('click', (event) => {
  const option = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-move-group-id]')
  if (!option) return
  const picked = option.dataset.moveGroupId
  if (!picked) return
  closeMoveGroupSheet(picked === MOVE_GROUP_NONE_VALUE ? '' : picked)
})

const closeOfflineNameSheet = () => {
  offlineNameOverlay.hidden = true
  offlineNameError.hidden = true
  offlineNameError.textContent = ''
  document.body.style.overflow = ''
}

const openOfflineNameSheet = () => {
  const currentName = getStoredOfflineDisplayName() ?? ''
  offlineNameInput.value = currentName
  offlineNameError.hidden = true
  offlineNameError.textContent = ''
  offlineNameOverlay.hidden = false
  document.body.style.overflow = 'hidden'
  setTimeout(() => offlineNameInput.focus(), 80)
}

const continueOfflineWithName = () => {
  const displayName = offlineNameInput.value.trim()
  if (!displayName) {
    offlineNameError.textContent = 'Please choose a name to continue offline.'
    offlineNameError.hidden = false
    return
  }

  setStoredOfflineDisplayName(displayName)
  setStoredOfflineMode(true)
  updateGreeting(displayName)
  setAuthUi(true)
  closeOfflineNameSheet()
  applyPendingSharedPayloadToForm(parseSharedPayloadFromLocation(window.location, window.history), {
    urlInput, titleInput, saveMessage, openComposer: () => openModal('link')
  })
  renderLinks()
  saveMessage.textContent = 'Running in local-only vault mode.'
}

offlineNameCancelBtn.addEventListener('click', closeOfflineNameSheet)
offlineNameContinueBtn.addEventListener('click', continueOfflineWithName)
offlineNameOverlay.addEventListener('click', (event) => {
  if (event.target === offlineNameOverlay) closeOfflineNameSheet()
})
offlineNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    continueOfflineWithName()
  }
})

// Collections view tabs
const viewGroupBtn = document.querySelector<HTMLButtonElement>('#view-group-btn')
const viewTagBtn   = document.querySelector<HTMLButtonElement>('#view-tag-btn')

const setCollectionsView = (mode: 'group' | 'tag') => {
  viewGroupBtn?.classList.toggle('coll-view-tab--active', mode === 'group')
  viewTagBtn?.classList.toggle('coll-view-tab--active',  mode === 'tag')
  viewModeSelect.value = mode
  setActiveTab('collections')
  renderLinks()
}

viewGroupBtn?.addEventListener('click', () => setCollectionsView('group'))
viewTagBtn?.addEventListener('click',   () => setCollectionsView('tag'))

// Swipe-like row actions
let swipeStartX = 0
let swipeStartY = 0
let swipeRow: HTMLElement | null = null

const closeAllRows = () => {
  for (const row of linkBoard.querySelectorAll<HTMLElement>('.link-row.is-revealed')) {
    row.classList.remove('is-revealed')
  }
}

linkBoard.addEventListener('pointerdown', (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-swipe-root]')
  if (!row) return
  swipeRow = row
  swipeStartX = event.clientX
  swipeStartY = event.clientY
})

linkBoard.addEventListener('pointerup', (event) => {
  if (!swipeRow) return
  const dx = event.clientX - swipeStartX
  const dy = Math.abs(event.clientY - swipeStartY)
  if (dy > 24) {
    swipeRow = null
    return
  }
  if (dx < -30) {
    closeAllRows()
    swipeRow.classList.add('is-revealed')
  } else if (dx > 24) {
    swipeRow.classList.remove('is-revealed')
  }
  swipeRow = null
})

linkBoard.addEventListener('click', (event) => {
  const emptyAddBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-empty-add]')
  if (emptyAddBtn) {
    event.preventDefault()
    event.stopPropagation()
    setActiveTab('home')
    openModal('link')
    return
  }

  const row = (event.target as HTMLElement).closest<HTMLElement>('.link-row')
  if (!row) closeAllRows()
})

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
  const groupId   = groupInput.value
  const tags      = parseTags(tagsInput.value)

  if (!url) {
    saveMessage.textContent = 'URL is required'
    return
  }

  const meta  = latestMetadata?.url === url ? latestMetadata : null

  const saved = await addLink(doc, {
    url,
    title: title || deriveFallbackTitle(url),
    groupId:     groupId || '',
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

  vibrateShort()
  saveMessage.textContent = 'Link saved to vault ✓'
  setTimeout(() => { saveMessage.textContent = '' }, 2500)
})

// New Group form
groupForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const name = groupNameInput.value.trim()
  if (!name) return

  const created = await createGroup(doc, name)

  // Pre-fill group in link modal and switch to it
  await applyLinkGroupOptions()
  groupInput.value = created.id
  groupForm.reset()
  vibrateShort()
  closeModal()
  openModal('link')
  setTimeout(() => urlInput.focus(), 150)
})

groupInput.addEventListener('change', () => {
  if (groupInput.value !== CREATE_GROUP_OPTION_VALUE) return
  groupInput.value = ''
  closeModal()
  openModal('group')
  setTimeout(() => groupNameInput.focus(), 120)
})

// PWA install
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event as InstallPromptEvent
  landingInstallBtn.hidden = false
  if (settingsInstallBtn) settingsInstallBtn.hidden = false
})

landingInstallBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return
  await deferredInstallPrompt.prompt()
  const choice = await deferredInstallPrompt.userChoice
  if (choice.outcome === 'accepted') {
    landingInstallBtn.hidden = true
    if (settingsInstallBtn) settingsInstallBtn.hidden = true
  }
  deferredInstallPrompt = null
})

settingsInstallBtn?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return
  await deferredInstallPrompt.prompt()
  const choice = await deferredInstallPrompt.userChoice
  if (choice.outcome === 'accepted') {
    landingInstallBtn.hidden = true
    settingsInstallBtn.hidden = true
  }
  deferredInstallPrompt = null
})

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null
  landingInstallBtn.hidden = true
  if (settingsInstallBtn) settingsInstallBtn.hidden = true
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

// ── Row actions (event delegation on the board) ───────────────────

linkBoard.addEventListener('click', (e) => {
  const moveBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-move-id]')
  if (moveBtn) {
    e.preventDefault()
    e.stopPropagation()

    const linkId = moveBtn.dataset.moveId
    if (!linkId) return
    const currentGroupId = moveBtn.dataset.currentGroupId ?? ''

    void (async () => {
      const nextGroupId = await openMoveGroupSheet(currentGroupId)
      if (nextGroupId === null || nextGroupId === currentGroupId) return
      await updateLink(doc, linkId, { groupId: nextGroupId })
      vibrateShort()
      closeAllRows()
    })()
    return
  }

  const copyBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-id]')
  if (copyBtn) {
    e.preventDefault()
    e.stopPropagation()
    const row = copyBtn.closest<HTMLElement>('.link-row')
    const anchor = row?.querySelector<HTMLAnchorElement>('.link-row-main')
    const href = anchor?.href
    if (href) {
      void navigator.clipboard.writeText(href).catch(() => {})
      vibrateShort()
    }
    closeAllRows()
    return
  }

  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-id]')
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()
  const id = btn.dataset.deleteId
  if (!id) return
  vibrateShort()
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
  const offlineDisplayName = getStoredOfflineDisplayName()

  if (session || isOfflineMode) {
    // Switch to user-specific vault so this account is fully isolated from others on this device
    if (session) {
      console.log('[boot] boot: switching vault to user:', session.username)
      detachVaultObservers(doc)
      doc = await switchVault(session.username)
      attachVaultObservers(doc)
      console.log('[boot] boot: vault switched, doc guid:', doc.guid)

      const trusted = await ensureTrustedDeviceOrAbort(session.token, identity, true)
      if (!trusted) {
        // User cancelled pairing from persisted session flow.
        return
      }

      // Phase 4: connect WebRTC for live P2P sync — pass auth so server can verify trust
      const provider = connectSync(
        `bnkr-vault-${session.username}`,
        SYNC_URL,
        { token: session.token, deviceId: identity.deviceId }
      )
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
      updateGreeting(offlineDisplayName)
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

window.addEventListener('beforeunload', () => {
  syncStatus?.cleanup()
  if (greetingRefreshTimer !== null) window.clearTimeout(greetingRefreshTimer)
})
