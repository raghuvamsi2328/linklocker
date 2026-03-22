import type { LinkData, GroupData } from '../yjsStore'

// ── Types ────────────────────────────────────────────────────────

export type LinkRow = {
  id: string
  label: string
  url: string
  pending: boolean
  createdAt: string
  group: string
  tags: string[]
  // Phase 5: rich metadata
  image?: string
  favicon?: string
  description?: string
  siteName?: string
}

export type BoardViewMode = 'group' | 'tag'

type GroupedRows = { key: string; items: LinkRow[] }

// ── Color helpers ────────────────────────────────────────────────

const PALETTE = ['accent', 'teal', 'lavender', 'rose', 'sky', 'lime', 'sand'] as const
const BUCKET_COLORS = ['#5A9B82', '#7B6EC8', '#C8607A', '#4D9DC8', '#5E9E4A', '#B8883A', '#9B7DC8']

const hashStr = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return h
}

const tagColor    = (t: string) => PALETTE[Math.abs(hashStr(t))  % PALETTE.length]
const bucketColor = (k: string) => BUCKET_COLORS[Math.abs(hashStr(k)) % BUCKET_COLORS.length]

// ── HTML helpers ─────────────────────────────────────────────────

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const getDomain = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}

// ── Data helpers ─────────────────────────────────────────────────

export const buildLinkRows = (links: LinkData[], groups: GroupData[]): LinkRow[] => {
  const groupName = new Map(groups.map((g) => [g.id, g.name]))
  return links.map((link) => ({
    id:          link.id,
    label:       link.title || link.url,
    url:         link.url,
    pending:     false,
    createdAt:   link.createdAt,
    group:       link.groupId ? (groupName.get(link.groupId) ?? '') : '',
    tags:        link.tags,
    image:       link.image,
    favicon:     link.favicon,
    description: link.description,
    siteName:    link.siteName
  }))
}

const groupRows = (rows: LinkRow[], mode: BoardViewMode): GroupedRows[] => {
  const map = new Map<string, LinkRow[]>()
  for (const row of rows) {
    if (mode === 'group') {
      const key = row.group || 'No Group'
      map.set(key, [...(map.get(key) ?? []), row])
    } else {
      const tags = row.tags.length > 0 ? row.tags : ['No Tag']
      for (const tag of tags) {
        map.set(tag, [...(map.get(tag) ?? []), row])
      }
    }
  }
  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export const applyGroupFilterOptions = (
  groupFilter: HTMLSelectElement,
  rows: LinkRow[]
): void => {
  const current = groupFilter.value
  const names = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort()
  groupFilter.innerHTML = '<option value="">All groups</option>'
  for (const name of names) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    groupFilter.append(opt)
  }
  if (names.includes(current)) groupFilter.value = current
  else groupFilter.value = ''
}

// ── Card renderer ────────────────────────────────────────────────

const renderPinHtml = (row: LinkRow): string => {
  const domain      = getDomain(row.url)
  const escapedUrl  = escapeHtml(row.url)
  const faviconSrc  = row.favicon
    ? escapeHtml(row.favicon)
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
  const descText    = row.description ? row.description.slice(0, 120) : ''

  return `
  <article class="pin${row.pending ? ' pending' : ''}" data-link-id="${escapeHtml(row.id)}">
    ${row.image ? `
    <a class="pin-hero-link" href="${escapedUrl}" target="_blank" rel="noreferrer" tabindex="-1" aria-hidden="true">
      <img class="pin-hero" src="${escapeHtml(row.image)}" loading="lazy" alt="" onerror="this.closest('.pin-hero-link').remove()">
    </a>` : ''}
    <div class="pin-card-top">
      <img class="pin-favicon"
        src="${faviconSrc}"
        loading="lazy" width="14" height="14"
        onerror="this.style.display='none'" alt="">
      <span class="pin-domain">${escapeHtml(domain)}</span>
      ${row.pending ? '<span class="pin-pending-badge">Pending</span>' : ''}
      <button class="pin-delete" data-delete-id="${escapeHtml(row.id)}"
        aria-label="Delete link" type="button" title="Delete">
        <span class="material-symbols-rounded" aria-hidden="true">close</span>
      </button>
    </div>
    <a class="pin-link" href="${escapedUrl}" target="_blank" rel="noreferrer">
      <div class="pin-content">
        <p class="pin-title">${escapeHtml(row.label)}</p>
        ${descText ? `<p class="pin-desc">${escapeHtml(descText)}</p>` : ''}
      </div>
    </a>
    <div class="pin-meta">
      ${row.tags.map((t) => `<span class="tag-${tagColor(t)}">#${escapeHtml(t)}</span>`).join('')}
    </div>
  </article>`
}

// ── Board HTML renderer ──────────────────────────────────────────

export const renderBoardHtml = (
  rows: LinkRow[],
  selectedGroup: string,
  searchNeedle: string,
  mode: BoardViewMode,
  bucketOpenState: Map<string, boolean>
): string => {
  const needle = searchNeedle.trim().toLowerCase()

  const filtered = rows.filter((row) => {
    const matchGroup = !selectedGroup || row.group === selectedGroup
    const matchSearch = !needle ||
      row.label.toLowerCase().includes(needle) ||
      row.url.toLowerCase().includes(needle) ||
      (row.description?.toLowerCase().includes(needle) ?? false) ||
      (row.siteName?.toLowerCase().includes(needle) ?? false) ||
      row.tags.some((t) => t.includes(needle))
    return matchGroup && matchSearch
  })

  if (filtered.length === 0) {
    return '<p class="empty-state">Nothing here yet — add your first link above.</p>'
  }

  return groupRows(filtered, mode)
    .map((bucket) => {
      const stateKey = `${mode}:${bucket.key}`
      const expanded = bucketOpenState.get(stateKey) ?? true
      const encoded  = encodeURIComponent(stateKey)
      const color    = bucketColor(bucket.key)
      const count    = bucket.items.length

      return `
      <article class="bucket">
        <header class="bucket-head">
          <button type="button" class="bucket-toggle"
            data-bucket-toggle data-bucket-key="${encoded}"
            aria-expanded="${expanded}">
            <span class="bucket-toggle-left">
              <span class="bucket-dot"
                style="background:${color};box-shadow:0 0 6px ${color}66"></span>
              <span class="bucket-name">${escapeHtml(bucket.key)}</span>
            </span>
            <small>${count} item${count === 1 ? '' : 's'}</small>
          </button>
        </header>
        <div class="pin-grid" ${expanded ? '' : 'hidden'}>
          ${bucket.items.map(renderPinHtml).join('')}
        </div>
      </article>`
    })
    .join('')
}
