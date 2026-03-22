/**
 * syncStatus.ts — Vault sync status indicator.
 *
 * Phase 1: Always "Local vault" (IndexedDB only).
 * Phase 4: Reflects live y-websocket connection state.
 */

import type { WebsocketProvider } from 'y-websocket'

export function attachSyncStatus(
  element: HTMLElement,
  getProvider: () => WebsocketProvider | null
): { cleanup: () => void; update: () => void } {
  const update = () => {
    if (!navigator.onLine) {
      element.textContent    = 'Offline'
      element.dataset.status = 'offline'
      return
    }

    const provider = getProvider()
    if (!provider) {
      element.textContent    = 'Local vault'
      element.dataset.status = 'synced'
      return
    }

    if (provider.wsconnected && provider.synced) {
      element.textContent    = 'Synced'
      element.dataset.status = 'synced'
    } else if (provider.wsconnected) {
      element.textContent    = 'Syncing…'
      element.dataset.status = 'pending'
    } else if (provider.wsconnecting) {
      element.textContent    = 'Connecting…'
      element.dataset.status = 'pending'
    } else {
      element.textContent    = 'Disconnected'
      element.dataset.status = 'offline'
    }
  }

  update()
  window.addEventListener('online',  update)
  window.addEventListener('offline', update)

  return {
    update,
    cleanup: () => {
      window.removeEventListener('online',  update)
      window.removeEventListener('offline', update)
    }
  }
}
