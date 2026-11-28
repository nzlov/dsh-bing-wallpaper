import { readFile } from 'node:fs/promises'
import { createBingSource, DAILY_PATH, DEPTH_PATH, IMAGE_PATH, SCENE_PATH, MARKET, RESOLUTION, isBingImageId, isBingMarket, isBingResolution } from './bing-source.js'
import { bootThemeInjection } from '../shared/boot-theme.js'
import { createDepthService } from './depth-service.js'
import { createImageAnalyzer } from './image-analysis.js'
import { createSharpSceneService } from './sharp-scene.js'

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

function binaryResponse(request, bytes, type, maxAge, extraHeaders = {}) {
  return new Response(request.method === 'HEAD' ? null : bytes, {
    headers: {
      'content-type': type,
      'content-length': String(bytes.byteLength),
      'cache-control': `private, max-age=${maxAge}`,
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      ...extraHeaders,
    },
  })
}

export const SHARP_ASSET_PATH = '/bing-daily-theme/assets/sharp-renderer.js'
const RESOURCE_PATHS = { daily: DAILY_PATH, image: IMAGE_PATH, depth: DEPTH_PATH, scene: SCENE_PATH, sharpAsset: SHARP_ASSET_PATH }
const SOURCE_QUERY = ['market', 'resolution']
const IMAGE_QUERY = [...SOURCE_QUERY, 'id']

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

export function createResources({ source, admit, depth, sharp, loadSharpAsset = () => readFile(new URL('../../dist/sharp-renderer.js', import.meta.url)) }) {
  let sharpAsset
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
    if (url.pathname !== RESOURCE_PATHS[kind]) return response(request, 404, { error: 'Not found' })
    if (url.search.length > 1024) return response(request, 400, { error: 'Invalid query' })
    if (kind === 'sharpAsset') {
      if (url.search) return response(request, 400, { error: 'Invalid query' })
      try {
        sharpAsset ??= loadSharpAsset().catch(error => { sharpAsset = undefined; throw error })
        const bytes = await waitFor(sharpAsset, request.signal)
        return binaryResponse(request, bytes, 'text/javascript; charset=utf-8', 0)
      } catch {
        if (request.signal.aborted) return response(request, 408, { error: 'Request cancelled' })
        return response(request, 503, { error: 'SHARP renderer unavailable' })
      }
    }
    const allowedKeys = kind === 'daily' ? SOURCE_QUERY : IMAGE_QUERY
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
        return response(request, 200, {
          ...metadata,
          ...(depth?.available ? { parallaxAvailable: true } : {}),
          ...(depth || sharp ? { parallaxModes: [...(depth?.available ? ['depth'] : []), ...(sharp?.available ? ['sharp'] : [])] } : {}),
        })
      } catch {
        if (request.signal.aborted) return response(request, 408, { error: 'Request cancelled' })
        return response(request, 502, { error: 'Bing wallpaper unavailable; please retry later' }, { 'retry-after': '60' })
      }
    }
    const id = url.searchParams.get('id')
    if (!isBingImageId(id)) return response(request, 400, { error: 'Invalid Bing image ID' })
    const image = source.image(id, market, resolution)
    if (!image) return response(request, 404, { error: 'Image not cached; refresh daily metadata first' })
    if (kind === 'scene') {
      if (!sharp?.available) return response(request, 501, { error: 'SHARP must be configured on the server' })
      try {
        const { bytes, width, height, focalPx, nearDepth } = await waitFor(sharp.load(image.bytes), request.signal)
        return binaryResponse(request, bytes, 'application/octet-stream', 3600, {
          'content-encoding': 'gzip',
          'x-bdt-scene-width': String(width),
          'x-bdt-scene-height': String(height),
          'x-bdt-scene-focal-px': String(focalPx),
          'x-bdt-scene-near-depth': String(nearDepth),
        })
      } catch {
        if (request.signal.aborted) return response(request, 408, { error: 'Request cancelled' })
        return response(request, 503, { error: 'SHARP scene unavailable; please retry later' }, { 'retry-after': '5' })
      }
    }
    if (kind === 'depth') {
      if (!depth?.available) return response(request, 501, { error: 'Depth parallax requires optional dependency @huggingface/transformers' })
      try {
        const payload = await waitFor(depth.estimate(image.bytes), request.signal)
        return binaryResponse(request, payload, 'application/octet-stream', 86400)
      } catch {
        if (request.signal.aborted) return response(request, 408, { error: 'Request cancelled' })
        return response(request, 503, { error: 'Depth map unavailable; please retry later' }, { 'retry-after': '60' })
      }
    }
    return binaryResponse(request, image.bytes, image.contentType, 3600)
  }
  return {
    daily: (request, peer) => serve(request, peer, 'daily'),
    image: (request, peer) => serve(request, peer, 'image'),
    depth: (request, peer) => serve(request, peer, 'depth'),
    scene: (request, peer) => serve(request, peer, 'scene'),
    sharpAsset: (request, peer) => serve(request, peer, 'sharpAsset'),
  }
}

export function apply(ctx) {
  // Structured injection runs before Client plugin loading. No index replacement.
  ctx.on('webserver/index-inject', (table, peer) => {
    if (peer.principal.kind === 'owner') table.push(bootThemeInjection())
  })
  ctx.effect(() => {
    const source = createBingSource({ analyzeImage: createImageAnalyzer() })
    const depth = createDepthService()
    const profileDir = ctx.get?.('profileContext')?.dir
    const sharp = createSharpSceneService({ profileDir })
    const resources = createResources({
      source,
      depth,
      sharp,
      admit: request => ctx.connection.admit({ headers: request.headers }),
    })
    const disposers = []
    function dispose() {
      sharp.dispose()
      depth.dispose()
      source.dispose() // Abort every outstanding upstream fetch before releasing routes.
      for (const dispose of disposers.reverse()) dispose()
    }
    try {
      // webServer.register() returns a plain disposer; it is not context-owned.
      for (const [name, path] of Object.entries(RESOURCE_PATHS)) {
        disposers.push(ctx.webServer.register({ kind: 'exact', path, resource: resources[name] }))
      }
    } catch (error) {
      dispose()
      throw error
    }
    return dispose
  })
}
