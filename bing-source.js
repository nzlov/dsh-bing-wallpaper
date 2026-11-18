// Intentionally dependency-free: each market uses only its fixed HTTPS Bing origin.
export const MARKET = 'zh-CN'
export const DAILY_PATH = '/bing-daily-theme/api/daily'
export const IMAGE_PATH = '/bing-daily-theme/api/image'
const BING_ORIGINS = new Map([
  ['zh-CN', 'https://cn.bing.com'],
  ['en-US', 'https://www.bing.com'],
])

export function isBingMarket(market) {
  return BING_ORIGINS.has(market)
}

function isSafeBingUrl(url) {
  return [...BING_ORIGINS.values()].includes(url.origin) && !url.username && !url.password
}

// No URLs, query strings, slashes, percent escapes, or alternate Bing resources.
export function isBingImageId(id) {
  return typeof id === 'string' && id.length <= 240
    && /^OHR\.[A-Za-z0-9][A-Za-z0-9_-]*_1920x1080\.jpg$/.test(id)
}

export class BingSourceError extends Error {}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) throw new BingSourceError('Invalid Bing date')
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
    throw new BingSourceError('Invalid Bing date')
  }
  return date
}

function parseArchive(bytes, market) {
  const origin = BING_ORIGINS.get(market)
  let image
  try { image = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).images?.[0] } catch {
    throw new BingSourceError('Invalid Bing archive JSON')
  }
  if (!image || typeof image.url !== 'string' || image.url.length > 2048) {
    throw new BingSourceError('Missing Bing image')
  }
  let url
  try { url = new URL(image.url, origin) } catch { throw new BingSourceError('Invalid Bing image URL') }
  const id = url.searchParams.get('id')
  if (!isSafeBingUrl(url) || url.pathname !== '/th'
    || url.hash || url.searchParams.getAll('id').length !== 1 || !isBingImageId(id)) {
    throw new BingSourceError('Invalid Bing image ID')
  }
  let copyrightUrl = `${origin}/`
  if (typeof image.copyrightlink === 'string' && image.copyrightlink.length <= 2048) {
    try {
      const link = new URL(image.copyrightlink, origin)
      if (isSafeBingUrl(link)) copyrightUrl = link.href
    } catch { /* Never pass an arbitrary or executable URL to the Client. */ }
  }
  return {
    id,
    metadata: {
      date: parseDate(image.startdate),
      title: typeof image.title === 'string' ? image.title.slice(0, 300) : '',
      copyright: typeof image.copyright === 'string' ? image.copyright.slice(0, 1000) : '',
      copyrightUrl,
      imageUrl: `${IMAGE_PATH}?${market === MARKET ? '' : `market=${market}&`}id=${encodeURIComponent(id)}`,
      market,
    },
  }
}

async function readLimited(response, limit) {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel().catch(() => {})
    throw new BingSourceError('Bing response exceeds size limit')
  }
  if (!response.body) throw new BingSourceError('Empty Bing response')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new BingSourceError('Bing response exceeds size limit')
      chunks.push(value)
    }
    if (!size) throw new BingSourceError('Empty Bing response')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

// Options are test seams, not plugin configuration. Production always uses defaults.
export function createBingSource({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 10_000,
  metadataMaxBytes = 128 * 1024,
  imageMaxBytes = 8 * 1024 * 1024,
  refreshMs = 60 * 60 * 1000,
  retryMs = 60 * 1000,
} = {}) {
  let disposed = false
  // No shared fallback or cache admission across markets, even for identical IDs.
  const states = new Map([...BING_ORIGINS.keys()].map(market => [market, {
    snapshot: undefined,
    nextCheck: 0,
    stale: false,
    pending: undefined,
    images: new Map(),
  }]))
  const controllers = new Set()

  async function download(url, kind) {
    if (disposed) throw new BingSourceError('Bing source disposed')
    const controller = new AbortController()
    controllers.add(controller)
    const timer = setTimeout(() => controller.abort(new BingSourceError('Bing request timed out')), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
        headers: { accept: kind === 'image' ? 'image/jpeg' : 'application/json' },
      })
      if (!response.ok || response.redirected || (response.url && response.url !== url)) {
        await response.body?.cancel().catch(() => {})
        throw new BingSourceError('Bing upstream request failed')
      }
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if (kind === 'image' ? type !== 'image/jpeg' : !['application/json', 'text/javascript'].includes(type)) {
        await response.body?.cancel().catch(() => {})
        throw new BingSourceError('Unexpected Bing response type')
      }
      const bytes = await readLimited(response, kind === 'image' ? imageMaxBytes : metadataMaxBytes)
      controller.signal.throwIfAborted()
      if (kind === 'image' && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
        throw new BingSourceError('Invalid Bing JPEG')
      }
      return bytes
    } finally {
      clearTimeout(timer)
      controllers.delete(controller)
    }
  }

  async function refresh(market, state) {
    const origin = BING_ORIGINS.get(market)
    try {
      const archiveUrl = `${origin}/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=${market}`
      const record = parseArchive(await download(archiveUrl, 'metadata'), market)
      let image = state.images.get(record.id)
      if (!image) {
        // Archive URLs only admit an ID; never fetch their endpoint or parameters.
        const url = `${origin}/th?id=${encodeURIComponent(record.id)}`
        image = { bytes: await download(url, 'image'), contentType: 'image/jpeg' }
      }
      if (disposed) throw new BingSourceError('Bing source disposed')
      // Atomic publication: a failed new download never replaces the old picture.
      state.images.delete(record.id)
      state.images.set(record.id, image)
      while (state.images.size > 2) state.images.delete(state.images.keys().next().value)
      state.snapshot = record.metadata
      state.stale = false
      state.nextCheck = now() + refreshMs
    } catch (error) {
      state.stale = true
      state.nextCheck = now() + retryMs
      if (disposed || !state.snapshot) throw error
    }
    return { ...state.snapshot, ...(state.stale ? { stale: true } : {}) }
  }

  return {
    async daily(market = MARKET) {
      if (disposed) throw new BingSourceError('Bing source disposed')
      if (!isBingMarket(market)) throw new BingSourceError('Unsupported Bing market')
      const state = states.get(market)
      if (now() < state.nextCheck) {
        if (!state.snapshot) throw new BingSourceError('Bing temporarily unavailable')
        return { ...state.snapshot, ...(state.stale ? { stale: true } : {}) }
      }
      if (!state.pending) state.pending = refresh(market, state).finally(() => { state.pending = undefined })
      return state.pending
    },
    image(id, market = MARKET) {
      if (disposed || !isBingMarket(market) || !isBingImageId(id)) return undefined
      // Even syntactically valid IDs must have been admitted by this market's archive.
      return states.get(market).images.get(id)
    },
    dispose() {
      disposed = true
      for (const controller of controllers) controller.abort(new BingSourceError('Bing source disposed'))
      controllers.clear()
      for (const state of states.values()) {
        state.images.clear()
        state.snapshot = undefined
      }
    },
  }
}
