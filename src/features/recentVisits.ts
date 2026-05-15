import type { LinkData } from '../yjsStore'

type RecentVisit = {
  linkId: string
  visitedAt: string
}

const RECENT_VISITS_LIMIT = 4

const getRecentVisitsKey = (scope: string) => `bnkr-recent-visits:${scope}`

const readRecentVisits = (scope: string): RecentVisit[] => {
  try {
    const raw = window.localStorage.getItem(getRecentVisitsKey(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentVisit[]
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.linkId && entry?.visitedAt) : []
  } catch {
    return []
  }
}

const writeRecentVisits = (scope: string, entries: RecentVisit[]) => {
  try {
    window.localStorage.setItem(getRecentVisitsKey(scope), JSON.stringify(entries))
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

export const trackRecentVisit = (scope: string, linkId: string) => {
  if (!scope || !linkId) return

  const nextEntry: RecentVisit = {
    linkId,
    visitedAt: new Date().toISOString()
  }

  const deduped = readRecentVisits(scope).filter((entry) => entry.linkId !== linkId)
  writeRecentVisits(scope, [nextEntry, ...deduped].slice(0, RECENT_VISITS_LIMIT))
}

export const getRecentVisitedLinks = (scope: string, links: LinkData[]): LinkData[] => {
  if (!scope || links.length === 0) return []

  const byId = new Map(links.map((link) => [link.id, link]))
  const visits = readRecentVisits(scope)
  const recentLinks = visits
    .map((entry) => byId.get(entry.linkId))
    .filter((link): link is LinkData => Boolean(link))

  if (recentLinks.length === visits.length) return recentLinks

  const validIds = new Set(recentLinks.map((link) => link.id))
  writeRecentVisits(scope, visits.filter((entry) => validIds.has(entry.linkId)))
  return recentLinks
}