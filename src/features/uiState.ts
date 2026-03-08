import type { SharedPayload } from './linkMetadata'

type SharedPayloadTargets = {
  urlInput: HTMLInputElement
  titleInput: HTMLInputElement
  saveMessage: HTMLElement
  composerCard: HTMLElement
  mobileMedia: MediaQueryList
}

export const setMobileCardExpanded = (card: HTMLElement, expanded: boolean): void => {
  const toggle = card.querySelector<HTMLButtonElement>('[data-card-toggle]')
  const body = card.querySelector<HTMLElement>('[data-card-body]')

  if (!toggle || !body) {
    return
  }

  toggle.setAttribute('aria-expanded', String(expanded))
  body.hidden = !expanded
}

export const syncMobileCardsForViewport = (
  cards: HTMLElement[],
  mobileMedia: MediaQueryList
): void => {
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

export const applyPendingSharedPayloadToForm = (
  payload: SharedPayload | null,
  targets: SharedPayloadTargets
): void => {
  if (!payload) {
    return
  }

  if (payload.url) {
    targets.urlInput.value = payload.url
  }

  if (payload.title) {
    targets.titleInput.value = payload.title
  }

  if (payload.text && !payload.title && !payload.url) {
    targets.titleInput.value = payload.text.slice(0, 120)
  }

  targets.saveMessage.textContent = payload.url
    ? 'Shared link received. Add optional group/tags and tap Save Link.'
    : 'Shared content received, but no URL was detected. Please paste URL manually.'

  if (targets.mobileMedia.matches) {
    setMobileCardExpanded(targets.composerCard, true)
  }
}
