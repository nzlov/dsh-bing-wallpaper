import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { createSharpSceneService } from '../src/server/sharp-scene.js'

const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const metadata = { width: 1920, height: 1080, focalPx: 1260.5, nearDepth: 1.5 }
const bytes = gzipSync(Buffer.alloc(32, 0x7f))
const scene = { bytes, ...metadata }
const header = Buffer.alloc(32)
header.write('BDS1')
header.writeUInt32LE(metadata.width, 4)
header.writeUInt32LE(metadata.height, 8)
header.writeDoubleLE(metadata.focalPx, 12)
header.writeDoubleLE(metadata.nearDepth, 20)
header.writeUInt32LE(1, 28)
const encoded = Buffer.concat([header, bytes])

async function fixture(t) {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'bdt-sharp-scene-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const checkpoint = path.join(cacheDir, 'model.pt')
  await writeFile(checkpoint, 'fixture weights')
  return { python: process.execPath, checkpoint, cacheDir }
}

test('SHARP coalesces concurrent generation, publishes only complete scenes, and reuses cache after restart', async t => {
  const options = await fixture(t)
  const scenes = path.join(options.cacheDir, 'scenes')
  let begin, finish, runs = 0
  const begun = new Promise(resolve => { begin = resolve })
  const finished = new Promise(resolve => { finish = resolve })
  const service = createSharpSceneService({
    ...options,
    async run(python, [isolated, script, input, output, checkpoint]) {
      runs++
      assert.equal(python, options.python)
      assert.equal(isolated, '-I')
      assert.equal(path.basename(script), 'render-sharp.py')
      assert.equal(checkpoint, options.checkpoint)
      assert.deepEqual(await readFile(input), image)
      await writeFile(output, encoded)
      begin()
      await finished
    },
  })
  assert.equal(service.available, true)
  const loads = [service.load(image), service.load(Buffer.from(image))]
  await begun
  try {
    assert.ok((await readdir(scenes)).every(name => name.startsWith('.generate-')))
  } finally { finish() }
  assert.deepEqual(await Promise.all(loads), [scene, scene])
  assert.equal(runs, 1)
  assert.match((await readdir(scenes))[0], /^[0-9a-f]{64}\.bdtscene$/)
  service.dispose()
  const reopened = createSharpSceneService({ ...options, run: () => assert.fail('reran a cached prediction') })
  t.after(() => reopened.dispose())
  assert.deepEqual(await reopened.load(image), scene)
})

test('SHARP retries invalid output and regenerates corrupted disk scenes', async t => {
  const options = await fixture(t)
  const scenes = path.join(options.cacheDir, 'scenes')
  let runs = 0
  const service = createSharpSceneService({
    ...options,
    async run(_python, [, , , output]) {
      await writeFile(output, ++runs === 1 ? encoded.subarray(0, -1) : encoded)
    },
  })
  t.after(() => service.dispose())
  await assert.rejects(service.load(image), /invalid scene/)
  assert.deepEqual(await readdir(scenes), [])
  assert.deepEqual(await service.load(image), scene)
  const [file] = await readdir(scenes)
  await writeFile(path.join(scenes, file), Buffer.alloc(encoded.length))
  assert.deepEqual(await service.load(image), scene)
  assert.equal(runs, 3)
})

test('SHARP cancels generation at disposal without publishing the scene', async t => {
  const options = await fixture(t)
  const service = createSharpSceneService({
    ...options,
    async run(_python, [, , , output], { signal }) {
      assert.equal(signal.aborted, false)
      await writeFile(output, encoded)
      service.dispose()
      assert.equal(signal.aborted, true)
    },
  })
  await assert.rejects(service.load(image), /disposed/)
  assert.equal(service.available, false)
  assert.deepEqual(await readdir(path.join(options.cacheDir, 'scenes')), [])
})

test('SHARP checks configured files and scopes new cache entries to each checkpoint', async t => {
  const options = await fixture(t)
  const missing = createSharpSceneService({ ...options, python: 'python3' })
  assert.equal(missing.available, false)
  await assert.rejects(missing.load(image), /unavailable/)

  let runs = 0
  const run = async (_python, [, , , output]) => {
    runs++
    await writeFile(output, encoded)
  }
  const first = createSharpSceneService({ ...options, run })
  await first.load(image)
  const replacement = `${options.checkpoint}.new`
  await writeFile(replacement, 'replacement')
  await rename(replacement, options.checkpoint)
  await assert.rejects(first.load(Buffer.from([1])), /checkpoint changed/)
  first.dispose()
  const next = createSharpSceneService({ ...options, run, maxDiskEntries: 1 })
  t.after(() => next.dispose())
  const scenes = path.join(options.cacheDir, 'scenes')
  const [oldFile] = await readdir(scenes)
  await utimes(path.join(scenes, oldFile), 0, 0)
  await next.load(image)
  assert.equal(runs, 2)
  const names = await readdir(scenes)
  assert.equal(names.length, 1)
  assert.notEqual(names[0], oldFile)
})

test('SHARP uses a complete manual installation in the profile, with optional paths taking precedence', async t => {
  const { python, checkpoint, cacheDir } = await fixture(t)
  const root = path.join(cacheDir, 'model-runtime', 'sharp')
  const manualPython = path.join(root, 'venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
  const manualWeights = path.join(root, 'sharp_2572gikvuh.pt')
  const loaded = []
  const options = { profileDir: cacheDir, python: '', checkpoint: '', cacheDir, async run(executable, [, , , output, weights]) {
    loaded.push([executable, weights])
    await writeFile(output, encoded)
  } }
  await mkdir(path.dirname(manualPython), { recursive: true })
  await writeFile(manualPython, 'fixture Python', { mode: 0o700 })
  assert.equal(createSharpSceneService(options).available, false)
  await writeFile(manualWeights, 'fixture weights')

  const manual = createSharpSceneService(options)
  t.after(() => manual.dispose())
  assert.equal(manual.available, true)
  assert.deepEqual(await manual.load(image), scene)
  const external = createSharpSceneService({ ...options, python, checkpoint })
  t.after(() => external.dispose())
  assert.equal(external.available, true)
  assert.deepEqual(await external.load(image), scene)
  assert.deepEqual(loaded, [[manualPython, manualWeights], [python, checkpoint]])
  assert.equal(createSharpSceneService({ ...options, python, checkpoint: '' }).available, false)
})

test('SHARP reuses the verified runtime from the former installer', async t => {
  const { cacheDir } = await fixture(t)
  const root = path.join(cacheDir, 'model-runtime', 'wallpaper-sharp')
  const name = 'runtime-1234-Z1b2c3'
  const python = path.join(root, name, 'venv', 'bin', 'python')
  const checkpoint = path.join(root, name, 'sharp_2572gikvuh.pt')
  await mkdir(path.dirname(python), { recursive: true })
  await writeFile(python, 'fixture Python', { mode: 0o700 })
  await writeFile(checkpoint, 'fixture weights')
  const marker = path.join(root, 'ready.json')
  const options = { cacheDir, profileDir: cacheDir, python: '', checkpoint: '' }
  assert.equal(createSharpSceneService(options).available, false)
  await writeFile(marker, JSON.stringify({ version: 1, name: '../wallpaper-sharp/' + name }))
  assert.equal(createSharpSceneService(options).available, false)
  await writeFile(marker, JSON.stringify({ version: 1, name, device: 'cuda' }))
  const reopened = createSharpSceneService({ ...options, async run(executable, [, , , output, weights]) {
    assert.equal(executable, python)
    assert.equal(weights, checkpoint)
    await writeFile(output, encoded)
  } })
  t.after(() => reopened.dispose())
  assert.equal(reopened.available, true)
  assert.deepEqual(await reopened.load(image), scene)
})

test('SHARP loads tiled scenes above 1.5 million splats and rejects mismatched record counts', async t => {
  const options = await fixture(t)
  const count = 1_500_001
  const largeHeader = Buffer.from(header)
  const gzip = gzipSync(Buffer.alloc(count * 32), { level: 1 })
  const service = createSharpSceneService({
    ...options,
    async run(_python, [, , , output]) {
      await writeFile(output, Buffer.concat([largeHeader, gzip]))
    },
  })
  t.after(() => service.dispose())
  largeHeader.writeUInt32LE(count - 1, 28)
  await assert.rejects(service.load(image), /invalid scene/)
  largeHeader.writeUInt32LE(count, 28)
  assert.deepEqual(await service.load(image), { ...metadata, bytes: gzip })
})
