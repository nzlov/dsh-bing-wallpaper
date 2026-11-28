import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, open, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultCacheDir, hashImageBytes } from './depth-service.js'

const SCRIPT = fileURLToPath(new URL('./render-sharp.py', import.meta.url))
const SCENE_HEADER_BYTES = 32
const CHECKPOINT_NAME = 'sharp_2572gikvuh.pt'

function fileIdentity(file, mode) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null
  try {
    const info = statSync(file, { bigint: true })
    if (!info.isFile()) return null
    accessSync(file, mode)
    return [file, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join('\0')
  } catch {
    return null
  }
}

function profileRuntime(profileDir) {
  if (typeof profileDir !== 'string' || !path.isAbsolute(profileDir)) return null
  const models = path.join(profileDir, 'model-runtime')
  const manual = path.join(models, 'sharp')
  const python = path.join(manual, 'venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
  const checkpoint = path.join(manual, CHECKPOINT_NAME)
  if (fileIdentity(python, constants.X_OK) && fileIdentity(checkpoint, constants.R_OK)) return { python, checkpoint }

  // Fall back to a verified environment from the previous installer.
  try {
    const previous = path.join(models, 'wallpaper-sharp')
    const { version, name } = JSON.parse(readFileSync(path.join(previous, 'ready.json'), 'utf8'))
    if (version !== 1 || typeof name !== 'string' || !/^runtime-[1-9][0-9]{0,9}-[A-Za-z0-9]{6}$/.test(name)) return null
    return {
      python: path.join(previous, name, 'venv', 'bin', 'python'),
      checkpoint: path.join(previous, name, CHECKPOINT_NAME),
    }
  } catch {
    return null
  }
}

function runProcess(executable, args, { signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      signal, timeout: 10 * 60_000, killSignal: 'SIGKILL', stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let error
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
    child.on('error', cause => { error = cause })
    child.on('close', (code, termination) => {
      if (error) reject(error)
      else if (code === 0) resolve()
      else reject(new Error(`SHARP exited with ${termination || code}: ${stderr.trim()}`))
    })
  })
}

async function readScene(file) {
  let handle
  try {
    handle = await open(file)
    const info = await handle.stat()
    if (!info.isFile() || info.size < SCENE_HEADER_BYTES + 20) return null
    const bytes = await handle.readFile()
    if (bytes.byteLength !== info.size || bytes.toString('ascii', 0, 4) !== 'BDS1') return null
    const width = bytes.readUInt32LE(4)
    const height = bytes.readUInt32LE(8)
    const focalPx = bytes.readDoubleLE(12)
    const nearDepth = bytes.readDoubleLE(20)
    const pointCount = bytes.readUInt32LE(28)
    if (width < 1 || height < 1 || width > 16_384 || height > 16_384
      || !Number.isFinite(focalPx) || focalPx <= 0 || !Number.isFinite(nearDepth) || nearDepth <= 0
      || pointCount < 1 || bytes.readUInt32LE(bytes.length - 4) !== (pointCount * 32) % 2 ** 32) return null
    const gzip = bytes.subarray(SCENE_HEADER_BYTES)
    if (gzip[0] !== 0x1f || gzip[1] !== 0x8b || gzip[2] !== 8) return null
    return { bytes: gzip, width, height, focalPx, nearDepth }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
    throw error
  } finally {
    await handle?.close()
  }
}

export function createSharpSceneService({
  profileDir,
  python = process.env.BDT_SHARP_PYTHON,
  checkpoint = process.env.BDT_SHARP_CHECKPOINT,
  cacheDir = defaultCacheDir(),
  maxDiskEntries = 6,
  maxPending = 8,
  run = runProcess,
} = {}) {
  if (!python && !checkpoint) ({ python, checkpoint } = profileRuntime(profileDir) ?? {})
  const pythonIdentity = fileIdentity(python, constants.X_OK)
  const checkpointIdentity = fileIdentity(checkpoint, constants.R_OK)
  const configured = Boolean(pythonIdentity && checkpointIdentity)
  const cacheVersion = JSON.stringify(['sharp-tiled-scene-v2', pythonIdentity, checkpointIdentity])
  const sceneDir = path.join(cacheDir, 'scenes')
  const pending = new Map()
  const lifecycle = new AbortController()
  const { signal } = lifecycle
  let queue = Promise.resolve()

  async function pruneDisk(current) {
    try {
      const names = (await readdir(sceneDir)).filter(name => /^[a-f0-9]{64}\.bdtscene$/.test(name))
      if (names.length <= maxDiskEntries) return
      const entries = await Promise.all(names.filter(name => name !== current).map(async name => {
        const file = path.join(sceneDir, name)
        return { file, mtime: (await stat(file).catch(() => null))?.mtimeMs ?? 0 }
      }))
      entries.sort((a, b) => b.mtime - a.mtime)
      for (const { file } of entries.slice(maxDiskEntries - 1)) await rm(file, { force: true })
    } catch { /* Cache eviction is best effort. */ }
  }

  async function generate(imageBytes, file) {
    signal.throwIfAborted()
    const cached = await readScene(file)
    if (cached) return cached
    const checkpointUnchanged = () => fileIdentity(checkpoint, constants.R_OK) === checkpointIdentity
    if (!checkpointUnchanged()) throw new Error('SHARP checkpoint changed. Restart DSH to apply it.')

    await mkdir(sceneDir, { recursive: true, mode: 0o700 })
    const job = await mkdtemp(path.join(sceneDir, '.generate-'))
    try {
      const input = path.join(job, 'input.jpg')
      const output = path.join(job, 'scene.bdtscene')
      await writeFile(input, imageBytes, { mode: 0o600 })
      await run(python, ['-I', SCRIPT, input, output, checkpoint], { signal })
      const scene = await readScene(output)
      if (!scene) throw new Error('SHARP returned an invalid scene')
      signal.throwIfAborted()
      if (!checkpointUnchanged()) throw new Error('SHARP checkpoint changed during generation')
      await rename(output, file)
      await pruneDisk(path.basename(file))
      return scene
    } finally {
      await rm(job, { recursive: true, force: true })
    }
  }

  async function readOrGenerate(imageBytes, file) {
    const scene = await readScene(file)
    signal.throwIfAborted()
    if (scene) {
      const now = new Date()
      await utimes(file, now, now).catch(() => {})
      return scene
    }
    // One model process at a time, including when different photos miss the disk cache.
    const generation = queue.then(() => generate(imageBytes, file))
    queue = generation.catch(() => {})
    return generation
  }

  return {
    get available() { return configured && !signal.aborted },
    async load(imageBytes) {
      signal.throwIfAborted()
      if (!configured) throw new Error('SHARP is unavailable')
      if (!(imageBytes instanceof Uint8Array) || imageBytes.length === 0) throw new Error('Invalid image bytes')
      const key = createHash('sha256').update(cacheVersion).update(hashImageBytes(imageBytes)).digest('hex')
      let task = pending.get(key)
      if (!task) {
        if (pending.size >= maxPending) throw new Error('SHARP generation queue is full')
        task = readOrGenerate(imageBytes, path.join(sceneDir, `${key}.bdtscene`)).finally(() => { pending.delete(key) })
        pending.set(key, task)
      }
      const scene = await task
      signal.throwIfAborted()
      return scene
    },
    dispose() { lifecycle.abort(new Error('SHARP service disposed')) },
  }
}
