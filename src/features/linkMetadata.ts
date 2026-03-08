export type ResolvedMetadata = {
  title: string
  description: string
  image: string
  favicon: string
  siteName: string
  tags: string[]
}

export type SharedPayload = {
  url: string
  title: string
  text: string
}

const normalizeSharedValue = (value: string | null): string => value?.trim() ?? ''

export const toValidUrl = (rawValue: string): string => {
  const value = rawValue.trim()
  if (!value) {
    return ''
  }

  const candidate = value.startsWith('www.') ? `https://${value}` : value

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return ''
  }

  return ''
}

export const isUrlLike = (value: string): boolean => /^https?:\/\//i.test(value) || /^www\./i.test(value)

const extractFirstUrl = (text: string): string => {
  if (!text) {
    return ''
  }

  const match = text.match(/(https?:\/\/[^\s<>")']+|www\.[^\s<>")']+)/i)
  if (!match) {
    return ''
  }

  return toValidUrl(match[0])
}

const resolveSharedUrl = (sharedUrl: string, sharedText: string, sharedTitle: string): string => {
  return (
    toValidUrl(sharedUrl) ||
    extractFirstUrl(sharedText) ||
    extractFirstUrl(sharedTitle) ||
    ''
  )
}

const resolveSharedTitle = (sharedTitle: string, sharedText: string, resolvedUrl: string): string => {
  const candidates = [sharedTitle, sharedText]

  for (const candidate of candidates) {
    const text = candidate.trim()
    if (!text) {
      continue
    }

    const detectedUrl = extractFirstUrl(text)
    const withoutUrl = detectedUrl ? text.replace(detectedUrl, '').replace(/\s+/g, ' ').trim() : text

    if (withoutUrl && withoutUrl !== resolvedUrl) {
      return withoutUrl.slice(0, 120)
    }

    if (!detectedUrl && !toValidUrl(text)) {
      return text.slice(0, 120)
    }
  }

  return ''
}

const hostToTag = (host: string): string => {
  const parts = host.replace(/^www\./i, '').split('.').filter(Boolean)
  if (parts.length === 0) {
    return ''
  }

  return parts[0].toLowerCase()
}

export const deriveFallbackTitle = (resolvedUrl: string): string => {
  if (!resolvedUrl) {
    return ''
  }

  try {
    const parsed = new URL(resolvedUrl)
    const path = parsed.pathname.replace(/\/$/, '')
    if (!path || path === '/') {
      return parsed.hostname.replace(/^www\./i, '')
    }

    const lastSegment = path.split('/').filter(Boolean).pop() ?? ''
    const normalized = decodeURIComponent(lastSegment)
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return normalized || parsed.hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

const fetchMetadataFromApi = async (url: string): Promise<Partial<ResolvedMetadata>> => {
  try {
    const response = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`)
    if (!response.ok) {
      return {}
    }

    const payload = (await response.json()) as {
      title?: string
      description?: string
      image?: string
      favicon?: string
      siteName?: string
    }

    return {
      title: (payload.title ?? '').trim(),
      description: (payload.description ?? '').trim(),
      image: (payload.image ?? '').trim(),
      favicon: (payload.favicon ?? '').trim(),
      siteName: (payload.siteName ?? '').trim()
    }
  } catch {
    return {}
  }
}

const parseTitleFromOEmbed = async (endpoint: string): Promise<string> => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(endpoint, { signal: controller.signal })
    if (!response.ok) {
      return ''
    }

    const payload = (await response.json()) as { title?: string }
    return (payload.title ?? '').trim()
  } catch {
    return ''
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const detectMetadataClientOnly = async (url: string): Promise<ResolvedMetadata> => {
  let host = ''

  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return {
      title: deriveFallbackTitle(url),
      description: '',
      image: '',
      favicon: '',
      siteName: '',
      tags: []
    }
  }

  const tagSet = new Set<string>()
  const hostTag = hostToTag(host)
  if (hostTag) {
    tagSet.add(hostTag)
  }

  const candidateEndpoints: string[] = []

  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    tagSet.add('video')
    tagSet.add('youtube')
    candidateEndpoints.push(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
  }

  if (host.includes('pinterest.')) {
    tagSet.add('pinterest')
    candidateEndpoints.push(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`)
  }

  candidateEndpoints.push(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)

  let title = ''
  for (const endpoint of candidateEndpoints) {
    title = await parseTitleFromOEmbed(endpoint)
    if (title) {
      break
    }
  }

  if (!title) {
    title = deriveFallbackTitle(url)
  }

  return {
    title,
    description: '',
    image: '',
    favicon: '',
    siteName: host.replace(/^www\./i, ''),
    tags: [...tagSet]
  }
}

export const detectMetadata = async (rawUrl: string): Promise<ResolvedMetadata> => {
  const url = toValidUrl(rawUrl)
  if (!url) {
    return {
      title: '',
      description: '',
      image: '',
      favicon: '',
      siteName: '',
      tags: []
    }
  }

  const fallback = await detectMetadataClientOnly(url)
  const apiMetadata = await fetchMetadataFromApi(url)

  return {
    title: apiMetadata.title || fallback.title,
    description: apiMetadata.description || '',
    image: apiMetadata.image || '',
    favicon: apiMetadata.favicon || '',
    siteName: apiMetadata.siteName || fallback.siteName,
    tags: fallback.tags
  }
}

export const parseSharedPayloadFromLocation = (location: Location, history: History): SharedPayload | null => {
  const params = new URLSearchParams(location.search)
  const sharedUrl = normalizeSharedValue(params.get('url'))
  const sharedTitle = normalizeSharedValue(params.get('title'))
  const sharedText = normalizeSharedValue(params.get('text'))
  const resolvedUrl = resolveSharedUrl(sharedUrl, sharedText, sharedTitle)
  const resolvedTitle = resolveSharedTitle(sharedTitle, sharedText, resolvedUrl)

  if (!sharedUrl && !sharedTitle && !sharedText) {
    return null
  }

  if (location.pathname === '/share') {
    history.replaceState({}, '', '/')
  } else {
    const cleanedUrl = `${location.pathname}${location.hash || ''}`
    history.replaceState({}, '', cleanedUrl)
  }

  return {
    url: resolvedUrl,
    title: resolvedTitle,
    text: sharedText
  }
}
