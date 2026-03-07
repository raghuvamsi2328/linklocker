import { getUnsyncedCount } from './db'

export function attachSyncStatus(element: HTMLElement): () => void {
  let timerId: number | undefined

  const refresh = async () => {
    let unsyncedCount = 0

    try {
      unsyncedCount = await getUnsyncedCount()
    } catch {
      element.textContent = 'Sync status unavailable'
      element.dataset.status = 'offline'
      return
    }

    if (unsyncedCount === 0) {
      element.textContent = 'All changes synced'
      element.dataset.status = 'synced'
      return
    }

    if (!navigator.onLine) {
      element.textContent = 'Offline - Changes will save later'
      element.dataset.status = 'offline'
      return
    }

    element.textContent = 'Syncing...'
    element.dataset.status = 'syncing'
  }

  const runRefresh = () => {
    void refresh()
  }

  runRefresh()
  window.addEventListener('online', runRefresh)
  window.addEventListener('offline', runRefresh)
  timerId = window.setInterval(runRefresh, 2500)

  return () => {
    if (timerId !== undefined) {
      window.clearInterval(timerId)
    }

    window.removeEventListener('online', runRefresh)
    window.removeEventListener('offline', runRefresh)
  }
}
