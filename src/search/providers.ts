import type { SearchResultItem } from '../types'

export interface SearchProvider {
  readonly name: string
  search(query: string, signal?: AbortSignal): Promise<SearchResultItem[]>
}

const REQUEST_TIMEOUT_MS = 12000

function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  return fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    })
    .finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    })
}

const githubProvider: SearchProvider = {
  name: 'GitHub',
  async search(query, signal) {
    const data = await fetchJson('https://api.github.com/search/repositories?q=' + encodeURIComponent(query) + '&sort=stars&order=desc&per_page=8', signal) as {
      items?: Array<{ full_name?: unknown; html_url?: unknown; description?: unknown; stargazers_count?: unknown; language?: unknown }>
    }
    return (data.items ?? []).map(item => ({
      title: String(item.full_name ?? ''),
      url: String(item.html_url ?? ''),
      snippet: String(item.description ?? '') || (typeof item.language === 'string' ? 'Language: ' + item.language : ''),
      source: 'GitHub' + (typeof item.stargazers_count === 'number' ? ' · ' + item.stargazers_count + ' stars' : ''),
    })).filter(item => item.title && item.url)
  },
}

const stackOverflowProvider: SearchProvider = {
  name: 'Stack Overflow',
  async search(query, signal) {
    const data = await fetchJson('https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=' + encodeURIComponent(query) + '&site=stackoverflow&pagesize=8&filter=default', signal) as {
      items?: Array<{ title?: unknown; link?: unknown; tags?: unknown[]; score?: unknown; answer_count?: unknown }>
    }
    return (data.items ?? []).map(item => ({
      title: String(item.title ?? ''),
      url: String(item.link ?? ''),
      snippet: Array.isArray(item.tags) ? 'Tags: ' + item.tags.slice(0, 5).join(', ') : '',
      source: 'Stack Overflow' + (typeof item.score === 'number' ? ' · ' + item.score + ' votes' : ''),
    })).filter(item => item.title && item.url)
  },
}

const hackerNewsProvider: SearchProvider = {
  name: 'Hacker News',
  async search(query, signal) {
    const data = await fetchJson('https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(query) + '&hitsPerPage=8', signal) as {
      hits?: Array<{ title?: unknown; url?: unknown; points?: unknown; author?: unknown; objectID?: unknown }>
    }
    return (data.hits ?? []).map(item => ({
      title: String(item.title ?? ''),
      url: typeof item.url === 'string' && item.url ? item.url : 'https://news.ycombinator.com/item?id=' + String(item.objectID ?? ''),
      snippet: typeof item.author === 'string' ? 'by ' + item.author : '',
      source: 'Hacker News' + (typeof item.points === 'number' ? ' · ' + item.points + ' points' : ''),
    })).filter(item => item.title)
  },
}

const npmProvider: SearchProvider = {
  name: 'npm',
  async search(query, signal) {
    const data = await fetchJson('https://registry.npmjs.org/-/v1/search?text=' + encodeURIComponent(query) + '&size=8', signal) as {
      objects?: Array<{ package?: { name?: unknown; version?: unknown; description?: unknown; links?: { npm?: unknown } } }>
    }
    return (data.objects ?? []).map(item => ({
      title: String(item.package?.name ?? ''),
      url: String(item.package?.links?.npm ?? ''),
      snippet: String(item.package?.description ?? ''),
      source: 'npm' + (typeof item.package?.version === 'string' ? ' · v' + item.package.version : ''),
    })).filter(item => item.title && item.url)
  },
}

const PROVIDERS: SearchProvider[] = [
  githubProvider,
  stackOverflowProvider,
  hackerNewsProvider,
  npmProvider,
]

export interface MultiSourceSearchResult {
  results: SearchResultItem[]
  sources: string[]
  failures: string[]
}

export async function searchWeb(query: string, signal?: AbortSignal): Promise<MultiSourceSearchResult> {
  const settled = await Promise.allSettled(PROVIDERS.map(provider => provider.search(query, signal)))
  const results: SearchResultItem[] = []
  const sources: string[] = []
  const failures: string[] = []
  const seenTitles = new Set<string>()
  for (let index = 0; index < settled.length; index++) {
    const outcome = settled[index]
    const provider = PROVIDERS[index]
    if (outcome.status === 'rejected') {
      failures.push(provider.name + ': ' + (outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)))
      continue
    }
    if (outcome.value.length === 0) {
      failures.push(provider.name + ': no results')
      continue
    }
    sources.push(provider.name)
    for (const item of outcome.value) {
      const key = item.title.replace(/\s+/g, '').slice(0, 40).toLowerCase()
      if (seenTitles.has(key)) continue
      seenTitles.add(key)
      results.push(item)
    }
  }
  return { results: results.slice(0, 20), sources, failures }
}
