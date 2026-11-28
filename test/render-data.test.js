import assert from 'node:assert/strict'
import test from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import jpeg from 'jpeg-js'
import { createBingSource, DAILY_PATH, SCENE_PATH } from '../src/server/bing-source.js'
import { createResources, SHARP_ASSET_PATH } from '../src/server/index.js'
import { createImageAnalyzer } from '../src/server/image-analysis.js'

const id = 'OHR.Palette_ZH-CN_1920x1080.jpg'
const pixels = Buffer.from(Array.from({ length: 24 * 16 }, () => [208, 41, 28, 255]).flat())
const image = jpeg.encode({ width: 24, height: 16, data: pixels }, 85).data
const owner = () => ({ principal: { kind: 'owner' }, signal: new AbortController().signal })
const request = (pathname, init) => new Request(`https://dsh.test${pathname}`, init)

test('daily metadata includes server-extracted colours and dimensions with analysis coalesced', async t => {
  const analyze = createImageAnalyzer()
  let analyzes = 0
  const source = createBingSource({
    async analyzeImage(bytes, signal) { analyzes++; return analyze(bytes, signal) },
    async fetchImpl(url) {
      return url.includes('HPImageArchive')
        ? Response.json({ images: [{ startdate: '20261127', url: `/th?id=${id}` }] })
        : new Response(image, { headers: { 'content-type': 'image/jpeg' } })
    },
  })
  t.after(() => source.dispose())
  const [a, b] = await Promise.all([source.daily(), source.daily()])
  assert.deepEqual(b, a)
  assert.deepEqual([a.imageWidth, a.imageHeight], [24, 16])
  assert.ok(a.imagePalette.content[0][0] > 190)
  assert.equal((await source.daily()).imagePalette, a.imagePalette)
  assert.equal(analyzes, 1)
})

test('SHARP exposes gzip model data and camera metadata for the current owner wallpaper', async () => {
  const wanted = `${SCENE_PATH}?id=${id}`
  const splat = Buffer.alloc(32)
  const compressed = gzipSync(splat)
  let ready = false
  const source = {
    async daily() { ready = true; return { date: '2026-11-27' } },
    image(candidate) { if (ready && candidate === id) return { bytes: image } },
  }
  const sharp = {
    available: true,
    async load(jpegBytes) {
      assert.equal(jpegBytes, image)
      return { bytes: compressed, width: 1920, height: 1080, focalPx: 1260.5, nearDepth: 1.5 }
    },
  }
  const resources = createResources({ source, sharp, depth: { available: true }, admit: () => ({ rejection: 401 }) })
  assert.equal((await resources.scene(request(wanted))).status, 401)
  assert.equal((await resources.scene(request(wanted), { ...owner(), principal: { kind: 'guest' } })).status, 403)
  assert.equal((await resources.scene(request(wanted), owner())).status, 404)
  const daily = await resources.daily(request(DAILY_PATH), owner())
  assert.deepEqual((await daily.json()).parallaxModes, ['depth', 'sharp'])
  for (const query of [`${wanted}&x=1`, `${wanted}&id=${id}`, `${SCENE_PATH}?id=bad`]) {
    assert.equal((await resources.scene(request(query), owner())).status, 400)
  }
  const result = await resources.scene(request(wanted), owner())
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('content-type'), 'application/octet-stream')
  assert.equal(result.headers.get('content-encoding'), 'gzip')
  assert.equal(result.headers.get('content-length'), String(compressed.length))
  assert.equal(result.headers.get('x-bdt-scene-width'), '1920')
  assert.equal(result.headers.get('x-bdt-scene-height'), '1080')
  assert.equal(result.headers.get('x-bdt-scene-focal-px'), '1260.5')
  assert.equal(result.headers.get('x-bdt-scene-near-depth'), '1.5')
  assert.deepEqual(gunzipSync(Buffer.from(await result.arrayBuffer())), splat)
  const head = await resources.scene(request(wanted, { method: 'HEAD' }), owner())
  assert.deepEqual([...head.headers], [...result.headers])
  assert.equal(await head.text(), '')
  const unconfigured = createResources({ source })
  assert.equal((await unconfigured.scene(request(wanted), owner())).status, 501)
})

test('optional SHARP script is owner-only and loaded once without a wallpaper request', async () => {
  let reads = 0
  const code = Buffer.from('export const fixture = true;')
  const resources = createResources({
    admit: () => ({ rejection: 401 }),
    async loadSharpAsset() { reads++; return code },
  })
  assert.equal((await resources.sharpAsset(request(SHARP_ASSET_PATH))).status, 401)
  assert.equal((await resources.sharpAsset(request(`${SHARP_ASSET_PATH}?q=1`), owner())).status, 400)
  assert.equal(reads, 0)
  const [get, head] = await Promise.all([
    resources.sharpAsset(request(SHARP_ASSET_PATH), owner()),
    resources.sharpAsset(request(SHARP_ASSET_PATH, { method: 'HEAD' }), owner()),
  ])
  assert.equal(reads, 1)
  assert.equal(get.status, 200)
  assert.equal(get.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal(get.headers.get('cache-control'), 'private, max-age=0')
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), code)
  assert.equal(head.headers.get('content-length'), String(code.length))
  assert.equal(await head.text(), '')
})
