import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createDepthService,
  encodeDepthPayload,
  hashImageBytes,
  isDepthRuntimeAvailable,
  isValidDepthPayload,
} from '../src/server/depth-service.js'

const JPEG_A = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9])
const JPEG_B = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x03, 0x04, 0xff, 0xd9])
const JPEG_C = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x05, 0x06, 0xff, 0xd9])

test('encodeDepthPayload and isValidDepthPayload validate magic, dimensions and exact byte length', () => {
  const bytes = new Uint8Array(6 * 4).map((_, i) => i * 10)
  const payload = encodeDepthPayload(bytes, 6, 4)
  assert.equal(payload.byteLength, 8 + 24)
  assert.equal(isValidDepthPayload(payload), true)
  assert.equal(isValidDepthPayload(payload.slice(0, -1)), false)
  const badMagic = payload.slice()
  badMagic[0] = 0x00
  assert.equal(isValidDepthPayload(badMagic), false)
  assert.throws(() => encodeDepthPayload(new Uint8Array(5), 6, 4))
})

test('same image is inferred at most once across concurrent requests, memory cache and service restarts', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bdt-depth-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const makeService = () => createDepthService({
    cacheDir: dir,
    width: 8,
    height: 6,
    async inferImpl(imageBytes, { width, height }) {
      calls++
      await gate
      const fill = imageBytes[4] * 30
      return new Uint8Array(width * height).fill(fill)
    },
  })

  const first = makeService()
  // 20 concurrent calls for the same image coalesce into 1 inference.
  const batch = Array.from({ length: 20 }, () => first.estimate(JPEG_A))
  release()
  const results = await Promise.all(batch)
  assert.equal(calls, 1)
  assert.equal(isValidDepthPayload(results[0]), true)
  for (const r of results) assert.deepEqual(r, results[0])

  // Repeat call hits in-memory cache.
  const cachedMem = await first.estimate(new Uint8Array(JPEG_A))
  assert.equal(calls, 1)
  assert.deepEqual(cachedMem, results[0])
  first.dispose()

  // New service instance (simulating server restart) hits persistent disk cache.
  const second = makeService()
  const cachedDisk = await second.estimate(JPEG_A)
  assert.equal(calls, 1, 'disk cache prevents recomputation across restarts')
  assert.deepEqual(cachedDisk, results[0])

  // Different image bytes trigger exactly one new inference.
  const other = await second.estimate(JPEG_B)
  assert.equal(calls, 2)
  assert.notDeepEqual(other, results[0])
  second.dispose()
})

test('corrupt disk cache entries are ignored and replaced, and disk cache prunes oldest entries', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bdt-depth-prune-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  let calls = 0
  const service = createDepthService({
    cacheDir: dir,
    width: 4,
    height: 4,
    maxDiskEntries: 2,
    async inferImpl(bytes, { width, height }) {
      calls++
      return new Uint8Array(width * height).fill(bytes[4] * 20)
    },
  })

  const depthDir = path.join(dir, 'depth')
  const firstPayload = await service.estimate(JPEG_A)
  assert.equal(calls, 1)
  service.dispose()

  // Corrupt the persisted file for JPEG_A.
  const corruptFile = path.join(depthDir, `${hashImageBytes(JPEG_A)}.bdtdepth`)
  await writeFile(corruptFile, new Uint8Array([1, 2, 3, 4]))

  const recovered = createDepthService({
    cacheDir: dir,
    width: 4,
    height: 4,
    maxDiskEntries: 2,
    async inferImpl(bytes, { width, height }) {
      calls++
      return new Uint8Array(width * height).fill(bytes[4] * 20)
    },
  })
  const recomputed = await recovered.estimate(JPEG_A)
  assert.equal(calls, 2)
  assert.deepEqual(recomputed, firstPayload)

  await recovered.estimate(JPEG_B)
  await recovered.estimate(JPEG_C)
  // Allow background best-effort prune to complete.
  await new Promise(resolve => setTimeout(resolve, 40))
  const files = (await readdir(depthDir)).filter(f => f.endsWith('.bdtdepth'))
  assert.ok(files.length <= 2, `expected at most 2 cached depth files, got ${files.length}`)
  recovered.dispose()
})

test('the browser receives a smoothed BDTD map and existing disk entries stay raw', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'bdt-depth-smooth-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const depthDir = path.join(cacheDir, 'depth')
  await mkdir(depthDir)
  const bytes = new Uint8Array(41).fill(255, 20)
  const input = encodeDepthPayload(bytes, 41, 1)
  const file = path.join(depthDir, `${hashImageBytes(JPEG_A)}.bdtdepth`)
  await writeFile(file, input)
  const options = { cacheDir, width: 41, height: 1, inferImpl: () => assert.fail('legacy raw depth map should be reused') }
  const first = createDepthService(options)
  const smoothed = await first.estimate(JPEG_A)
  assert.equal(isValidDepthPayload(smoothed), true)
  assert.ok(smoothed[8 + 19] > 0 && smoothed[8 + 20] < 255)
  assert.equal(await first.estimate(JPEG_A), smoothed)
  first.dispose()
  const restarted = createDepthService(options)
  t.after(() => restarted.dispose())
  assert.deepEqual(await restarted.estimate(JPEG_A), smoothed)
  assert.deepEqual(await readFile(file), Buffer.from(input))
})

test('depth service reports unavailable and refuses inference when optional peer dependency is missing', async () => {
  assert.equal(isDepthRuntimeAvailable(() => { throw new Error('ERR_MODULE_NOT_FOUND') }), false)
  assert.equal(isDepthRuntimeAvailable(() => 'file:///fake/@huggingface/transformers/index.js'), true)

  const missing = createDepthService({
    cacheDir: null,
    resolveImpl: () => { throw new Error('ERR_MODULE_NOT_FOUND') },
  })
  assert.equal(missing.available, false)
  await assert.rejects(() => missing.estimate(JPEG_A), /Depth runtime unavailable/)
  missing.dispose()

  const present = createDepthService({
    cacheDir: null,
    resolveImpl: () => 'file:///fake/@huggingface/transformers/index.js',
  })
  assert.equal(present.available, true)
  present.dispose()
  assert.equal(present.available, false)
})
