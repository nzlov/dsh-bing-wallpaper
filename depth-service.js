import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small'
export const DEPTH_DTYPE = 'q8'
export const DEPTH_WIDTH = 256
export const DEPTH_HEIGHT = 144
export const DEPTH_MAGIC = new Uint8Array([0x42, 0x44, 0x54, 0x44]) // "BDTD"
export const DEPTH_HEADER_BYTES = 8

export function encodeDepthPayload(depthBytes, width = DEPTH_WIDTH, height = DEPTH_HEIGHT) {
  if (!(depthBytes instanceof Uint8Array) || depthBytes.byteLength !== width * height) {
    throw new Error('Invalid depth map dimensions')
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new Error('Depth map size out of range')
  }
  const out = new Uint8Array(DEPTH_HEADER_BYTES + depthBytes.byteLength)
  out.set(DEPTH_MAGIC, 0)
  out[4] = (width >> 8) & 0xff
  out[5] = width & 0xff
  out[6] = (height >> 8) & 0xff
  out[7] = height & 0xff
  out.set(depthBytes, DEPTH_HEADER_BYTES)
  return out
}

export function isValidDepthPayload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= DEPTH_HEADER_BYTES) return false
  for (let i = 0; i < 4; i++) if (bytes[i] !== DEPTH_MAGIC[i]) return false
  const width = (bytes[4] << 8) | bytes[5]
  const height = (bytes[6] << 8) | bytes[7]
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return false
  return bytes.byteLength === DEPTH_HEADER_BYTES + width * height
}

export function hashImageBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function defaultResolveTransformers(id) {
  try {
    return import.meta.resolve(id)
  } catch {
    return import.meta.resolve(id, pathToFileURL(path.join(process.cwd(), 'package.json')).href)
  }
}

export function resolveDepthRuntime(resolveImpl = defaultResolveTransformers) {
  try {
    const resolved = resolveImpl('@huggingface/transformers')
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : null
  } catch {
    return null
  }
}

export function isDepthRuntimeAvailable(resolveImpl = defaultResolveTransformers) {
  return Boolean(resolveDepthRuntime(resolveImpl))
}

function defaultCacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, 'dsh-bing-wallpaper')
}

export function createDepthService({
  cacheDir = defaultCacheDir(),
  model = DEPTH_MODEL,
  dtype = DEPTH_DTYPE,
  width = DEPTH_WIDTH,
  height = DEPTH_HEIGHT,
  maxMemoryEntries = 8,
  maxDiskEntries = 60,
  available,
  resolveImpl,
  inferImpl,
} = {}) {
  const resolvedRuntime = typeof available === 'boolean'
    ? (available ? (resolveDepthRuntime(resolveImpl) || '@huggingface/transformers') : null)
    : (inferImpl ? '@huggingface/transformers' : resolveDepthRuntime(resolveImpl))
  const runtimeAvailable = Boolean(resolvedRuntime)
  const depthDir = cacheDir ? path.join(cacheDir, 'depth') : null
  const modelDir = cacheDir ? path.join(cacheDir, 'models') : null
  const memoryCache = new Map()
  const pending = new Map()
  let pipelinePromise = null
  let pipelineInstance = null
  let disposed = false

  function rememberMemory(key, payload) {
    memoryCache.delete(key)
    memoryCache.set(key, payload)
    while (memoryCache.size > maxMemoryEntries) {
      memoryCache.delete(memoryCache.keys().next().value)
    }
  }

  function diskPath(key) {
    if (!depthDir) return null
    return path.join(depthDir, `${key}.bdtdepth`)
  }

  async function readDisk(key) {
    const file = diskPath(key)
    if (!file) return null
    try {
      const data = new Uint8Array(await readFile(file))
      return isValidDepthPayload(data) ? data : null
    } catch {
      return null
    }
  }

  async function pruneDisk() {
    if (!depthDir || maxDiskEntries <= 0) return
    try {
      const names = (await readdir(depthDir)).filter(name => name.endsWith('.bdtdepth'))
      if (names.length <= maxDiskEntries) return
      const entries = await Promise.all(names.map(async name => {
        const full = path.join(depthDir, name)
        try { return { full, mtime: (await stat(full)).mtimeMs } }
        catch { return null }
      }))
      const sorted = entries.filter(Boolean).sort((a, b) => b.mtime - a.mtime)
      for (const entry of sorted.slice(maxDiskEntries)) {
        await unlink(entry.full).catch(() => {})
      }
    } catch { /* Best-effort cache pruning only. */ }
  }

  async function writeDisk(key, payload) {
    const file = diskPath(key)
    if (!file) return
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    try {
      await mkdir(depthDir, { recursive: true })
      await writeFile(temp, payload)
      await rename(temp, file)
      void pruneDisk()
    } catch {
      await unlink(temp).catch(() => {})
    }
  }

  async function loadPipeline() {
    if (disposed) throw new Error('Depth service disposed')
    if (!runtimeAvailable) throw new Error('Depth runtime unavailable')
    if (!pipelinePromise) {
      pipelinePromise = (async () => {
        const transformers = await import(resolvedRuntime)
        if (modelDir) {
          await mkdir(modelDir, { recursive: true }).catch(() => {})
          transformers.env.cacheDir = modelDir
        }
        const estimator = await transformers.pipeline('depth-estimation', model, { dtype })
        if (disposed) {
          await estimator.dispose?.().catch(() => {})
          throw new Error('Depth service disposed')
        }
        pipelineInstance = estimator
        return { estimator, RawImage: transformers.RawImage }
      })().catch(error => {
        pipelinePromise = null
        throw error
      })
    }
    return pipelinePromise
  }

  async function runInference(imageBytes) {
    if (inferImpl) {
      const result = await inferImpl(imageBytes, { width, height })
      if (result instanceof Uint8Array && isValidDepthPayload(result)) return result
      const data = result?.data instanceof Uint8Array ? result.data : result
      const outW = result?.width ?? width
      const outH = result?.height ?? height
      return encodeDepthPayload(data, outW, outH)
    }
    const { estimator, RawImage } = await loadPipeline()
    if (disposed) throw new Error('Depth service disposed')
    const input = await RawImage.fromBlob(new Blob([imageBytes], { type: 'image/jpeg' }))
    const output = await estimator(input)
    if (disposed) throw new Error('Depth service disposed')
    const resized = await output.depth.resize(width, height)
    const raw = resized.data
    let grayscale
    if (resized.channels === 1 && raw.byteLength === width * height) {
      grayscale = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    } else {
      const stride = Math.max(1, resized.channels || Math.round(raw.byteLength / (width * height)))
      grayscale = new Uint8Array(width * height)
      for (let i = 0; i < width * height; i++) grayscale[i] = raw[i * stride] ?? 0
    }
    return encodeDepthPayload(grayscale, width, height)
  }

  async function computeOnce(key, imageBytes) {
    const cached = await readDisk(key)
    if (cached) {
      if (!disposed) rememberMemory(key, cached)
      return cached
    }
    const payload = await runInference(imageBytes)
    if (disposed) throw new Error('Depth service disposed')
    rememberMemory(key, payload)
    await writeDisk(key, payload)
    return payload
  }

  return {
    get available() {
      return runtimeAvailable && !disposed
    },
    async estimate(imageBytes) {
      if (disposed) throw new Error('Depth service disposed')
      if (!runtimeAvailable) throw new Error('Depth runtime unavailable')
      if (!(imageBytes instanceof Uint8Array) || imageBytes.byteLength === 0) {
        throw new Error('Invalid image bytes')
      }
      const key = hashImageBytes(imageBytes)
      const hit = memoryCache.get(key)
      if (hit) {
        rememberMemory(key, hit)
        return hit
      }
      let task = pending.get(key)
      if (!task) {
        task = computeOnce(key, imageBytes).finally(() => { pending.delete(key) })
        pending.set(key, task)
      }
      return task
    },
    dispose() {
      disposed = true
      memoryCache.clear()
      pending.clear()
      const instance = pipelineInstance
      pipelineInstance = null
      pipelinePromise = null
      if (instance?.dispose) void Promise.resolve(instance.dispose()).catch(() => {})
    },
  }
}
