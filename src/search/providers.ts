import type { SearchResultItem } from '../types'

export interface SearchProvider {
  readonly name: string
  search(query: string, signal?: AbortSignal): Promise<SearchResultItem[]>
}

const REQUEST_TIMEOUT_MS = 12000
const GENERAL_SEARCH_TIMEOUT_MS = 35000

// 为所有搜索请求统一处理超时和外层取消信号，防止失效来源拖住整个 Agent 回合。
function fetchJson(
  url: string,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  return fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    .then((response) => {
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
    const data = (await fetchJson(
      'https://api.github.com/search/repositories?q=' +
        encodeURIComponent(query) +
        '&sort=stars&order=desc&per_page=8',
      signal,
    )) as {
      items?: {
        full_name?: unknown
        html_url?: unknown
        description?: unknown
        stargazers_count?: unknown
        language?: unknown
      }[]
    }
    return (data.items ?? [])
      .map((item) => ({
        title: String(item.full_name ?? ''),
        url: String(item.html_url ?? ''),
        snippet:
          String(item.description ?? '') ||
          (typeof item.language === 'string' ? 'Language: ' + item.language : ''),
        source:
          'GitHub' +
          (typeof item.stargazers_count === 'number'
            ? ' · ' + item.stargazers_count + ' stars'
            : ''),
      }))
      .filter((item) => item.title && item.url)
  },
}

const stackOverflowProvider: SearchProvider = {
  name: 'Stack Overflow',
  async search(query, signal) {
    const data = (await fetchJson(
      'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=' +
        encodeURIComponent(query) +
        '&site=stackoverflow&pagesize=8&filter=default',
      signal,
    )) as {
      items?: {
        title?: unknown
        link?: unknown
        tags?: unknown[]
        score?: unknown
        answer_count?: unknown
      }[]
    }
    return (data.items ?? [])
      .map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.link ?? ''),
        snippet: Array.isArray(item.tags) ? 'Tags: ' + item.tags.slice(0, 5).join(', ') : '',
        source:
          'Stack Overflow' + (typeof item.score === 'number' ? ' · ' + item.score + ' votes' : ''),
      }))
      .filter((item) => item.title && item.url)
  },
}

const hackerNewsProvider: SearchProvider = {
  name: 'Hacker News',
  async search(query, signal) {
    const data = (await fetchJson(
      'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(query) + '&hitsPerPage=8',
      signal,
    )) as {
      hits?: {
        title?: unknown
        url?: unknown
        points?: unknown
        author?: unknown
        objectID?: unknown
      }[]
    }
    return (data.hits ?? [])
      .map((item) => ({
        title: String(item.title ?? ''),
        url:
          typeof item.url === 'string' && item.url
            ? item.url
            : 'https://news.ycombinator.com/item?id=' + String(item.objectID ?? ''),
        snippet: typeof item.author === 'string' ? 'by ' + item.author : '',
        source:
          'Hacker News' + (typeof item.points === 'number' ? ' · ' + item.points + ' points' : ''),
      }))
      .filter((item) => item.title)
  },
}

const npmProvider: SearchProvider = {
  name: 'npm',
  async search(query, signal) {
    const data = (await fetchJson(
      'https://registry.npmjs.org/-/v1/search?text=' + encodeURIComponent(query) + '&size=8',
      signal,
    )) as {
      objects?: {
        package?: {
          name?: unknown
          version?: unknown
          description?: unknown
          links?: { npm?: unknown }
        }
      }[]
    }
    return (data.objects ?? [])
      .map((item) => ({
        title: String(item.package?.name ?? ''),
        url: String(item.package?.links?.npm ?? ''),
        snippet: String(item.package?.description ?? ''),
        source:
          'npm' + (typeof item.package?.version === 'string' ? ' · v' + item.package.version : ''),
      }))
      .filter((item) => item.title && item.url)
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

// 原有纯前端链路专门查询开发者站点，保持关闭通用搜索时的历史行为。
export async function searchDeveloperWeb(
  query: string,
  signal?: AbortSignal,
): Promise<MultiSourceSearchResult> {
  const settled = await Promise.allSettled(
    PROVIDERS.map((provider) => provider.search(query, signal)),
  )
  const results: SearchResultItem[] = []
  const sources: string[] = []
  const failures: string[] = []
  const seenTitles = new Set<string>()
  for (let index = 0; index < settled.length; index++) {
    const outcome = settled[index]
    const provider = PROVIDERS[index]
    if (outcome.status === 'rejected') {
      failures.push(
        provider.name +
          ': ' +
          (outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)),
      )
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

// 将用户频繁变化的 Quick Tunnel 域名规范化为 HTTPS 基地址。
export function normalizeGeneralSearchBaseUrl(value: string): string {
  const raw = value.trim()
  if (!raw) throw new Error('通用搜索服务地址为空，请先在 Agent 设置中填写 Cloudflare 域名。')
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error('通用搜索服务地址格式无效，请填写 Cloudflare Tunnel 域名。')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('通用搜索服务地址只支持 HTTP 或 HTTPS。')
  if (url.username || url.password) throw new Error('通用搜索服务地址不能包含用户名或密码。')
  return url.href.replace(/\/+$/, '')
}

// 通用搜索链路通过 Python 服务访问百度和 Bing，浏览器只接收结构化 JSON。
export async function searchGeneralWeb(
  baseUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<MultiSourceSearchResult> {
  const endpoint = new URL(normalizeGeneralSearchBaseUrl(baseUrl) + '/api/search')
  endpoint.searchParams.set('q', query)
  endpoint.searchParams.set('engine', 'all')
  endpoint.searchParams.set('num', '8')
  const data = (await fetchJson(endpoint.href, signal, GENERAL_SEARCH_TIMEOUT_MS)) as {
    results?: unknown
    sources?: unknown
    failures?: unknown
  }
  const results = Array.isArray(data.results)
    ? data.results
        .map((item): SearchResultItem | null => {
          if (!item || typeof item !== 'object') return null
          const value = item as Record<string, unknown>
          const title = typeof value.title === 'string' ? value.title : ''
          const url = typeof value.url === 'string' ? value.url : ''
          if (!title || !url) return null
          return {
            title,
            url,
            snippet: typeof value.snippet === 'string' ? value.snippet : '',
            source: typeof value.source === 'string' ? value.source : undefined,
          }
        })
        .filter((item): item is SearchResultItem => item !== null)
    : []
  const sources = Array.isArray(data.sources)
    ? data.sources.filter((item): item is string => typeof item === 'string')
    : []
  const failures = Array.isArray(data.failures)
    ? data.failures.filter((item): item is string => typeof item === 'string')
    : []
  return { results: results.slice(0, 20), sources, failures }
}
