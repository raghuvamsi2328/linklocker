import type { LocalLink } from '../db'

export type ServerLinkForBoard = {
  url: string
  title: string
  group_name: string | null
  tags: string[]
  created_at: string
}

export type LinkRow = {
  label: string
  url: string
  pending: boolean
  createdAt: string
  group: string
  tags: string[]
}

export type BoardViewMode = 'group' | 'tag'

type GroupedRows = {
  key: string
  items: LinkRow[]
}

const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const groupRowsForBoard = (rows: LinkRow[], mode: BoardViewMode): GroupedRows[] => {
  const groupedMap = new Map<string, LinkRow[]>()

  for (const row of rows) {
    if (mode === 'group') {
      const key = row.group || 'No Group'
      groupedMap.set(key, [...(groupedMap.get(key) ?? []), row])
      continue
    }

    const tags = row.tags.length > 0 ? row.tags : ['No Tag']
    for (const tag of tags) {
      groupedMap.set(tag, [...(groupedMap.get(tag) ?? []), row])
    }
  }

  return [...groupedMap.entries()]
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export const buildLinkRows = (
  serverLinks: ServerLinkForBoard[],
  localLinks: LocalLink[],
  offlineOnlyMode: boolean
): LinkRow[] => {
  const localLinksForView = offlineOnlyMode ? localLinks : localLinks.filter((link) => !link.synced)
  const rows: LinkRow[] = []

  for (const link of serverLinks) {
    rows.push({
      label: link.title || link.url,
      url: link.url,
      pending: false,
      createdAt: link.created_at,
      group: link.group_name ?? '',
      tags: link.tags ?? []
    })
  }

  for (const link of localLinksForView) {
    rows.push({
      label: link.title || link.url,
      url: link.url,
      pending: offlineOnlyMode ? false : !link.synced,
      createdAt: link.createdAt,
      group: link.group,
      tags: link.tags
    })
  }

  return rows
}

export const applyGroupFilterOptions = (groupFilter: HTMLSelectElement, rows: LinkRow[]): void => {
  const currentGroup = groupFilter.value
  const groups = [...new Set(rows.map((row) => row.group).filter(Boolean))].sort((a, b) => a.localeCompare(b))

  groupFilter.innerHTML = '<option value="">All groups</option>'
  for (const group of groups) {
    const option = document.createElement('option')
    option.value = group
    option.textContent = group
    groupFilter.append(option)
  }

  if (groups.includes(currentGroup)) {
    groupFilter.value = currentGroup
  } else {
    groupFilter.value = ''
  }
}

export const renderBoardHtml = (
  rows: LinkRow[],
  selectedGroup: string,
  tagNeedle: string,
  mode: BoardViewMode,
  bucketOpenState: Map<string, boolean>
): string => {
  const filteredRows = rows.filter((row) => {
    const matchesGroup = !selectedGroup || row.group === selectedGroup
    const matchesTag = !tagNeedle || row.tags.some((tag) => tag.includes(tagNeedle))
    return matchesGroup && matchesTag
  })

  if (filteredRows.length === 0) {
    return '<p class="empty-state">It feels empty here.</p>'
  }

  const groups = groupRowsForBoard(filteredRows, mode)

  return groups
    .map((grouped) => {
      const bucketStateKey = `${mode}:${grouped.key}`
      const expanded = bucketOpenState.get(bucketStateKey) ?? true
      const encodedBucketKey = encodeURIComponent(bucketStateKey)

      return `
      <article class="bucket">
        <header class="bucket-head">
          <button type="button" class="bucket-toggle" data-bucket-toggle data-bucket-key="${encodedBucketKey}" aria-expanded="${expanded}">
            <span>${escapeHtml(grouped.key)}</span>
            <small>${grouped.items.length} item${grouped.items.length === 1 ? '' : 's'}</small>
          </button>
        </header>
        <div class="pin-grid" ${expanded ? '' : 'hidden'}>
          ${grouped.items
            .map((row) => {
              const domain = getDomain(row.url)
              return `
              <a class="pin ${row.pending ? 'pending' : ''}" href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">
                <div class="pin-card-top">
                  <img class="pin-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32" loading="lazy" width="16" height="16" onerror="this.style.display='none'" alt="">
                  <span class="pin-domain">${escapeHtml(domain)}</span>
                  ${row.pending ? '<span class="pin-pending-badge">Pending</span>' : ''}
                </div>
                <div class="pin-content">
                  <p class="pin-title">${escapeHtml(row.label)}</p>
                  <div class="pin-meta">
                    ${row.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}
                  </div>
                </div>
              </a>
            `
            })
            .join('')}
        </div>
      </article>
    `
    })
    .join('')
}
