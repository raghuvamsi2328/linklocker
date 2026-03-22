import type { SharedPayload } from './linkMetadata'

type SharedPayloadTargets = {
  urlInput: HTMLInputElement
  titleInput: HTMLInputElement
  saveMessage: HTMLElement
  openComposer: () => void
}

export const applyPendingSharedPayloadToForm = (
  payload: SharedPayload | null,
  targets: SharedPayloadTargets
): void => {
  if (!payload) return

  if (payload.url)   targets.urlInput.value   = payload.url
  if (payload.title) targets.titleInput.value = payload.title
  if (payload.text && !payload.title && !payload.url) {
    targets.titleInput.value = payload.text.slice(0, 120)
  }

  targets.saveMessage.textContent = payload.url
    ? 'Shared link received. Add optional group/tags and tap Save Link.'
    : 'Shared content received, but no URL was detected. Please paste URL manually.'

  targets.openComposer()
}
