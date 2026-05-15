import type { GroupData, LinkData } from '../yjsStore'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function renderHomeRecentLinks(links: LinkData[]): string {
  const recent = links.slice(0, 4)

  if (recent.length === 0) {
    return '<p class="home-preview-empty">Your latest links will appear here.</p>'
  }

  return `
    <div class="home-recent-list">
      ${recent.map((link) => {
        const label = escapeHtml(link.title || getDomain(link.url))
        const domain = escapeHtml(link.siteName || getDomain(link.url))
        const url = escapeHtml(link.url)
        return `
          <a class="home-recent-item" href="${url}" target="_blank" rel="noreferrer">
            <span class="home-recent-title">${label}</span>
            <span class="home-recent-domain">${domain}</span>
          </a>`
      }).join('')}
    </div>`
}

export function renderHomeGroups(groups: GroupData[], links: LinkData[]): string {
  const linkCountByGroup = new Map<string, number>()

  for (const link of links) {
    const key = link.groupId || '__ungrouped'
    linkCountByGroup.set(key, (linkCountByGroup.get(key) ?? 0) + 1)
  }

  const groupChips = groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      emoji: group.emoji,
      count: linkCountByGroup.get(group.id) ?? 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const ungroupedCount = linkCountByGroup.get('__ungrouped') ?? 0
  if (ungroupedCount > 0) {
    groupChips.push({
      id: '__ungrouped',
      name: 'No Group',
      emoji: '📎',
      count: ungroupedCount
    })
  }

  if (groupChips.length === 0) {
    return '<p class="home-preview-empty">Create groups to organize your vault.</p>'
  }

  return `
    <div class="home-group-chips">
      ${groupChips.map((group) => `
        <button type="button" class="home-group-chip" data-home-group-name="${escapeHtml(group.id)}">
          <span class="home-group-chip-emoji">${escapeHtml(group.emoji)}</span>
          <span class="home-group-chip-name">${escapeHtml(group.name)}</span>
          <span class="home-group-chip-count">${group.count}</span>
        </button>
      `).join('')}
    </div>`
}
