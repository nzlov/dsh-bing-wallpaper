import { createBingSource, DAILY_PATH, DEPTH_PATH, IMAGE_PATH, MARKET, RESOLUTION, isBingImageId, isBingMarket, isBingResolution } from './bing-source.js'
import { bootThemeInjection } from '../shared/boot-theme.js'
import { createDepthService } from './depth-service.js'

// The carrier does not authenticate named routes. Connection is a real dependency.
export const inject = ['webServer', 'connection']

function response(request, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value)
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      ...extraHeaders,
    },
  })
}

function waitFor(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    // One disconnected reader must not cancel the refresh other readers share.
    promise.then(value => {
      signal.removeEventListener('abort', abort)
      resolve(value)
    }, error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}

export function createResources({ source, admit, depth }) {
  async function serve(request, peer, kind) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response(request, 405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' })
    }
    try {
      // readResource callers have already admitted their Peer. HTTP has no Peer:
      // re-use DSH's signed cookie / Host / Origin policy, never URL authority.
      const admission = peer ? { peer } : admit(request)
      if ('rejection' in admission) return response(request, admission.rejection, { error: 'Authentication required' })
      if (admission.peer.signal.aborted) return response(request, 401, { error: 'Peer expired' })
      if (admission.peer.principal.kind !== 'owner') return response(request, 403, { error: 'Owner access required' })
    } catch {
      // A missing/unavailable auth provider must never turn this into a public proxy.
      return response(request, 503, { error: 'DSH authentication unavailable' })
    }
    if (request.signal.aborted) return response(request, 408, { error: 'Request cancelled' })
    const url = new URL(request.url)
    const expectedPath = kind === 'daily' ? DAILY_PATH : kind === 'depth' ? DEPTH_PATH : IMAGE_PATH
    if (url.pathname !== expectedPath) return response(request, 404, { error: 'Not found' })
    if (url.search.length > 1024) return response(request, 400, { error: 'Invalid query' })
    const allowedKeys = kind === 'daily' ? ['market', 'resolution'] : ['market', 'id', 'resolution']
    if ([...url.searchParams.keys()].some(name => !allowedKeys.includes(name))
      || allowedKeys.some(name => url.searchParams.getAll(name).length > 1)) {
      return response(request, 400, { error: 'Invalid query' })
    }
    const market = url.searchParams.has('market') ? url.searchParams.get('market') : MARKET
    if (!isBingMarket(market)) return response(request, 400, { error: 'Unsupported Bing market' })
    const resolution = url.searchParams.has('resolution') ? url.searchParams.get('resolution') : RESOLUTION
    if (!isBingResolution(resolution)) return response(request, 400, { error: 'Unsupported Bing resolution' })
    if (kind === 'daily') {
      try {
        const metadata = await waitFor(source.daily(market, resolution), request.signal)
        return response(request, 200, depth?.available ? { ...metadata, parallaxAvailable: true } : metadata)
      } catch {
        if (request.signal.aborted) return response(request, 408, { error: 'Request cancelled' })
        return response(request, 502, { error: 'Bing wallpaper unavailable; please retry later' }, { 'retry-after': '60' })
      }
    }
    const id = url.searchParams.get('id')
    if (!isBingImageId(id)) return response(request, 400, { error: 'Invalid Bing image ID' })
    const image = source.image(id, market, resolution)
    if (!image) return response(request, 404, { error: 'Image not cached; refresh daily metadata first' })
    if (kind === 'depth') {
      if (!depth?.available) return response(request, 501, { error: 'Depth parallax requires optional dependency @huggingface/transformers' })
      try {
        const payload = await waitFor(depth.estimate(image.bytes), request.signal)
        return new Response(request.method === 'HEAD' ? null : payload, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(payload.byteLength),
            'cache-control': 'private, max-age=86400',
            'x-content-type-options': 'nosniff',
            'cross-origin-resource-policy': 'same-origin',
          },
        })
      } catch {
        if (request.signal.aborted) return response(request, 408, { error: 'Request cancelled' })
        return response(request, 503, { error: 'Depth map unavailable; please retry later' }, { 'retry-after': '60' })
      }
    }
    return new Response(request.method === 'HEAD' ? null : image.bytes, {
      headers: {
        'content-type': image.contentType,
        'content-length': String(image.bytes.byteLength),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
      },
    })
  }
  return {
    daily: (request, peer) => serve(request, peer, 'daily'),
    image: (request, peer) => serve(request, peer, 'image'),
    depth: (request, peer) => serve(request, peer, 'depth'),
  }
}

export function apply(ctx) {
  // Structured injection runs before Client plugin loading. No index replacement.
  ctx.on('webserver/index-inject', (table, peer) => {
    if (peer.principal.kind === 'owner') table.push(bootThemeInjection())
  })
  ctx.effect(() => {
    const source = createBingSource()
    const depth = createDepthService()
    const resources = createResources({
      source,
      depth,
      admit: request => ctx.connection.admit({ headers: request.headers }),
    })
    const disposers = []
    try {
      // webServer.register() returns a plain disposer; it is not context-owned.
      disposers.push(ctx.webServer.register({ kind: 'exact', path: DAILY_PATH, resource: resources.daily }))
      disposers.push(ctx.webServer.register({ kind: 'exact', path: IMAGE_PATH, resource: resources.image }))
      disposers.push(ctx.webServer.register({ kind: 'exact', path: DEPTH_PATH, resource: resources.depth }))
    } catch (error) {
      depth.dispose()
      source.dispose()
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => {
      depth.dispose()
      source.dispose() // Abort every outstanding upstream fetch before releasing routes.
      for (const dispose of disposers.reverse()) dispose()
    }
  })
}
