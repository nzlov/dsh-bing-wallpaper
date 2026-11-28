import test from 'node:test'
import assert from 'node:assert/strict'
import { createBingSource, DAILY_PATH, DEPTH_PATH, IMAGE_PATH, SCENE_PATH, isBingImageId } from '../src/server/bing-source.js'
import { encodeDepthPayload } from '../src/server/depth-service.js'
import { apply, createResources, inject, SHARP_ASSET_PATH } from '../src/server/index.js'

const ID = 'OHR.LakeBled_ZH-CN1234567890_1920x1080.jpg'
const OTHER_ID = 'OHR.Forest_ZH-CN9876543210_1920x1080.jpg'
const THIRD_ID = 'OHR.Mountain_ZH-CN4567890123_1920x1080.jpg'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])
const ARCHIVE_URL = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN'
const GLOBAL_ARCHIVE_URL = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US'
const MARKETS = ['zh-CN', 'en-US']
const ORIGINS = { 'zh-CN': 'https://cn.bing.com', 'en-US': 'https://www.bing.com' }
const owner = () => ({ principal: { kind: 'owner' }, signal: new AbortController().signal })
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const jpeg = () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })
function archive(id = ID, extra = {}) {
  return { images: [{ startdate: '20261118', title: 'Lake Bled', copyright: '© Example photographer',
    copyrightlink: 'https://www.bing.com/search?q=Lake+Bled', url: `/th?id=${id}&rf=LaDigue_1920x1080.jpg&pid=hp`, ...extra }] }
}
function request(path = `${DAILY_PATH}?market=zh-CN`, options = {}) {
  return new Request(`http://x${path}`, options)
}
function fixture(options = {}) {
  const calls = []
  const source = createBingSource({ fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return url.includes('HPImageArchive') ? json(archive()) : jpeg()
  }, ...options })
  return { source, calls }
}
function resources(source, admit = () => ({ peer: owner() })) { return createResources({ source, admit }) }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('strict ID allowlist rejects URLs, paths, extra parameters and alternate formats', () => {
  assert.ok(isBingImageId(ID))
  for (const id of [null, '', 'https://www.bing.com/th?id=' + ID, 'OHR.../secret_1920x1080.jpg',
    `${ID}&x=1`, `${ID}%26x=1`, 'OHR.foo_UHD.jpg', 'OHR.foo_1920x1080.svg',
    'OHR.foo_1920x1080.jpg#x', `OHR.${'a'.repeat(240)}_1920x1080.jpg`]) {
    assert.equal(isBingImageId(id), false, String(id))
  }
})

test('daily metadata uses same-origin image URL and bounded fixed upstream requests', async () => {
  const { source, calls } = fixture()
  const data = await source.daily()
  assert.deepEqual(data, { date: '2026-11-18', title: 'Lake Bled', copyright: '© Example photographer',
    copyrightUrl: 'https://www.bing.com/search?q=Lake+Bled', imageUrl: `${IMAGE_PATH}?id=${ID}`, market: 'zh-CN' })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, ARCHIVE_URL)
  assert.equal(calls[1].url, `https://cn.bing.com/th?id=${ID}`)
  for (const { init } of calls) {
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    assert.ok(init.signal instanceof AbortSignal)
    assert.equal(init.headers.cookie, undefined)
  }
  assert.deepEqual(source.image(ID).bytes, JPEG)
  source.dispose()
})

test('parallel refreshes coalesce and fresh metadata never refetches', async () => {
  const gate = deferred()
  const { source, calls } = fixture({ fetchImpl: async url => {
    calls.push({ url })
    if (url.includes('HPImageArchive')) { await gate.promise; return json(archive()) }
    return jpeg()
  } })
  const requests = Array.from({ length: 30 }, () => source.daily())
  assert.equal(calls.length, 1)
  gate.resolve()
  const data = await Promise.all(requests)
  assert.equal(calls.length, 2)
  assert.ok(data.every(item => item.imageUrl === data[0].imageUrl))
  await source.daily()
  assert.equal(calls.length, 2)
  source.dispose()
})

test('failed new image keeps previous metadata and bytes, with retry backoff', async () => {
  let clock = 0, generation = 0, calls = 0
  const source = createBingSource({ now: () => clock, refreshMs: 100, retryMs: 20,
    fetchImpl: async url => {
      calls++
      if (url.includes('HPImageArchive')) return json(archive(generation ? OTHER_ID : ID))
      return generation === 1 ? new Response('offline', { status: 503 }) : jpeg()
    } })
  const first = await source.daily()
  clock = 101; generation = 1
  const stale = await source.daily()
  assert.deepEqual(stale, { ...first, stale: true })
  assert.deepEqual(source.image(ID).bytes, JPEG)
  assert.equal(source.image(OTHER_ID), undefined)
  const before = calls
  clock = 110
  assert.equal((await source.daily()).stale, true)
  assert.equal(calls, before)
  clock = 122; generation = 2
  const recovered = await source.daily()
  assert.equal(recovered.stale, undefined)
  assert.ok(recovered.imageUrl.endsWith(OTHER_ID))
  source.dispose()
})

test('archive failure preserves old snapshot and initial failure is negatively cached', async () => {
  let clock = 0, failed = false, calls = 0
  const source = createBingSource({ now: () => clock, refreshMs: 10, retryMs: 5, fetchImpl: async url => {
    calls++
    if (failed) throw new Error('offline')
    return url.includes('HPImageArchive') ? json(archive()) : jpeg()
  } })
  await source.daily()
  failed = true; clock = 11
  assert.equal((await source.daily()).stale, true)
  assert.equal(calls, 3)
  source.dispose()
  const cold = createBingSource({ now: () => clock, fetchImpl: async () => { calls++; throw new Error('offline') } })
  await assert.rejects(cold.daily(), /offline/)
  await assert.rejects(cold.daily(), /temporarily unavailable/)
  assert.equal(calls, 4)
  cold.dispose()
})

test('same ID reuses JPEG and only current plus previous admitted ID remains', async () => {
  let clock = 0, id = ID, imageCalls = 0
  const source = createBingSource({ now: () => clock, refreshMs: 10, fetchImpl: async url => {
    if (url.includes('HPImageArchive')) return json(archive(id))
    imageCalls++; return jpeg()
  } })
  await source.daily()
  clock = 11; await source.daily()
  assert.equal(imageCalls, 1)
  clock = 22; id = OTHER_ID; await source.daily()
  assert.ok(source.image(ID))
  clock = 33; id = THIRD_ID; await source.daily()
  assert.equal(source.image(ID), undefined)
  assert.ok(source.image(OTHER_ID))
  assert.ok(source.image(THIRD_ID))
  source.dispose()
})

test('unsafe archive URLs, malformed metadata and invalid dates never reach image fetch', async t => {
  for (const extra of [
    { url: 'https://evil.test/th?id=' + ID }, { url: '//evil.test/th?id=' + ID },
    { url: `https://www.bing.com@evil.test/th?id=${ID}` }, { url: `/other?id=${ID}` },
    { url: `/th?id=${ID}&id=${OTHER_ID}` }, { url: '/th?id=https://127.0.0.1/' },
    { startdate: '20260230' }, { startdate: '../secret' }, { url: null },
  ]) {
    await t.test(JSON.stringify(extra), async () => {
      let count = 0
      const source = createBingSource({ fetchImpl: async () => { count++; return json(archive(ID, extra)) } })
      await assert.rejects(source.daily())
      assert.equal(count, 1)
      source.dispose()
    })
  }
})

test('unsafe copyright links fall back to Bing, while text lengths are bounded', async () => {
  const { source } = fixture({ fetchImpl: async url => url.includes('HPImageArchive')
    ? json(archive(ID, { copyrightlink: 'javascript:alert(1)', title: 't'.repeat(1000), copyright: 'c'.repeat(3000) })) : jpeg() })
  const data = await source.daily()
  assert.equal(data.copyrightUrl, 'https://cn.bing.com/')
  assert.equal(data.title.length, 300)
  assert.equal(data.copyright.length, 1000)
  source.dispose()
})

test('limits reject declared and streamed oversized metadata/image responses', async t => {
  for (const kind of ['metadata', 'image']) for (const declared of [true, false]) {
    await t.test(`${kind}, content-length=${declared}`, async () => {
      let cancelled = false
      const source = createBingSource({ metadataMaxBytes: kind === 'metadata' ? 8 : 4096, imageMaxBytes: 8,
        fetchImpl: async url => {
          if (kind === 'image' && url.includes('HPImageArchive')) return json(archive())
          return new Response(new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array(9)) },
            cancel() { cancelled = true },
          }), { headers: { 'content-type': kind === 'metadata' ? 'application/json' : 'image/jpeg',
            ...(declared ? { 'content-length': '9' } : {}) } })
        } })
      await assert.rejects(source.daily(), /size limit/)
      assert.equal(cancelled, true)
      assert.equal(source.image(ID), undefined)
      source.dispose()
    })
  }
})

test('upstream redirects, incorrect types, empty/corrupt responses are refused', async t => {
  const invalid = [
    () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1' } }),
    () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    () => new Response('not a jpeg', { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response(null, { headers: { 'content-type': 'image/jpeg' } }),
  ]
  for (const [i, makeResponse] of invalid.entries()) await t.test(String(i), async () => {
    const { source } = fixture({ fetchImpl: async url => url.includes('HPImageArchive') ? json(archive()) : makeResponse() })
    await assert.rejects(source.daily())
    assert.equal(source.image(ID), undefined)
    source.dispose()
  })
  const { source } = fixture({ fetchImpl: async () => new Response('{oops', { headers: { 'content-type': 'application/json' } }) })
  await assert.rejects(source.daily(), /archive JSON/)
  source.dispose()
})

test('both markets refuse redirects and substituted response URLs for metadata and images', async t => {
  for (const market of MARKETS) for (const kind of ['metadata', 'image']) {
    for (const mode of ['status', 'redirected', 'foreign-url', 'other-market-url']) {
      await t.test(`${market}: ${kind}, ${mode}`, async () => {
        let cancelled = false, count = 0
        const source = createBingSource({ fetchImpl: async url => {
          count++
          if (kind === 'image' && url.includes('HPImageArchive')) return json(archive())
          const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), {
            status: mode === 'status' ? 302 : 200,
            headers: { 'content-type': kind === 'metadata' ? 'application/json' : 'image/jpeg',
              ...(mode === 'status' ? { location: 'https://evil.test/' } : {}) },
          })
          if (mode === 'redirected') Object.defineProperty(response, 'redirected', { value: true })
          if (mode === 'foreign-url') Object.defineProperty(response, 'url', { value: 'https://evil.test/' })
          if (mode === 'other-market-url') Object.defineProperty(response, 'url', {
            value: url.replace(ORIGINS[market], ORIGINS[market === 'zh-CN' ? 'en-US' : 'zh-CN']),
          })
          return response
        } })
        await assert.rejects(source.daily(market), /upstream request failed/)
        assert.equal(count, kind === 'metadata' ? 1 : 2)
        assert.equal(cancelled, true)
        assert.equal(source.image(ID, market), undefined)
        source.dispose()
      })
    }
  }
})

test('timeout aborts stalled upstream headers and stalled response bodies', async t => {
  for (const phase of ['headers', 'body']) await t.test(phase, async () => {
    let aborted = false
    const { source } = fixture({ timeoutMs: 15, fetchImpl: async (_url, { signal }) => {
      if (phase === 'headers') return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
      })
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => { aborted = true; controller.error(signal.reason) }, { once: true })
      } }), { headers: { 'content-type': 'application/json' } })
    } })
    await assert.rejects(source.daily(), /timed out/)
    assert.equal(aborted, true)
    source.dispose()
  })
})

test('dispose aborts pending upstream requests and refuses future calls', async () => {
  let signal
  const { source } = fixture({ fetchImpl: async (_url, options) => {
    signal = options.signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  const pending = source.daily()
  source.dispose()
  assert.equal(signal.aborted, true)
  await assert.rejects(pending, /disposed/)
  await assert.rejects(source.daily(), /disposed/)
  assert.equal(source.image(ID), undefined)
})

test('HTTP resources enforce admission before fetching, and fail closed', async () => {
  const { source, calls } = fixture()
  for (const status of [401, 403]) {
    const api = resources(source, req => {
      assert.equal(req.headers.get('cookie'), 'signed-cookie')
      return { rejection: status }
    })
    assert.equal((await api.daily(request(undefined, { headers: { cookie: 'signed-cookie' } }))).status, status)
    assert.equal((await api.image(request(`${IMAGE_PATH}?id=${ID}`, { headers: { cookie: 'signed-cookie' } }))).status, status)
  }
  const broken = resources(source, () => { throw new Error('connection unavailable') })
  assert.equal((await broken.daily(request())).status, 503)
  assert.equal(calls.length, 0)
  source.dispose()
})

test('admitted in-process owner works, non-owner or disposed peer is rejected', async () => {
  const { source, calls } = fixture()
  const api = resources(source, () => { throw new Error('HTTP admission should not run') })
  assert.equal((await api.daily(request(), { principal: { kind: 'guest' }, signal: new AbortController().signal })).status, 403)
  const controller = new AbortController(); controller.abort()
  assert.equal((await api.daily(request(), { principal: { kind: 'owner' }, signal: controller.signal })).status, 401)
  assert.equal(calls.length, 0)
  assert.equal((await api.daily(request(), owner())).status, 200)
  source.dispose()
})

test('query/method validation rejects unsupported markets, duplicates and proxy input', async () => {
  const { source, calls } = fixture()
  const api = resources(source)
  for (const query of ['market=fr-FR', 'market=zh-cn', 'market=EN-US', 'market=__proto__',
    'market=zh-CN&market=zh-CN', 'market=zh-CN&market=en-US', 'market=en-US&market=en-US',
    'market=en-US&%6darket=zh-CN', 'url=https://evil.test', 'market=', `x=${'a'.repeat(1025)}`]) {
    assert.equal((await api.daily(request(`${DAILY_PATH}?${query}`))).status, 400, query)
  }
  for (const query of ['', 'id=https://evil.test', `id=${ID}&url=http://127.0.0.1`, `id=${ID}&id=${ID}`,
    `market=&id=${ID}`, `market=fr-FR&id=${ID}`, `market=__proto__&id=${ID}`, `market=zh-cn&id=${ID}`,
    `market=zh-CN&market=en-US&id=${ID}`, `market=en-US&market=en-US&id=${ID}`,
    `market=en-US&%6darket=zh-CN&id=${ID}`, `market=en-US&id=${ID}&%69d=${ID}`,
    `market=en-US&id=${ID}&extra=value`]) {
    assert.equal((await api.image(request(`${IMAGE_PATH}?${query}`))).status, 400)
  }
  const unknown = await api.image(request(`${IMAGE_PATH}?id=${OTHER_ID}`))
  assert.equal(unknown.status, 404)
  for (const resource of [api.daily, api.image]) {
    const result = await resource(request(undefined, { method: 'POST', body: 'ignored' }))
    assert.equal(result.status, 405)
    assert.equal(result.headers.get('allow'), 'GET, HEAD')
  }
  assert.equal(calls.length, 0)
  source.dispose()
})

test('GET and HEAD return canvas-safe same-origin JPEG without CORS relaxation', async () => {
  const { source, calls } = fixture()
  const api = resources(source)
  const metadataResponse = await api.daily(request())
  assert.equal(metadataResponse.status, 200)
  const data = await metadataResponse.json()
  for (const method of ['GET', 'HEAD']) {
    const imageResponse = await api.image(request(data.imageUrl, { method }))
    assert.equal(imageResponse.status, 200)
    assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg')
    assert.equal(imageResponse.headers.get('content-length'), String(JPEG.length))
    assert.equal(imageResponse.headers.get('cross-origin-resource-policy'), 'same-origin')
    assert.equal(imageResponse.headers.get('access-control-allow-origin'), null)
    assert.match(imageResponse.headers.get('cache-control'), /^private,/)
    assert.equal((await imageResponse.arrayBuffer()).byteLength, method === 'HEAD' ? 0 : JPEG.length)
  }
  const head = await api.daily(request(undefined, { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  const errorHead = await api.image(request(`${IMAGE_PATH}?id=bad`, { method: 'HEAD' }))
  assert.equal(errorHead.status, 400)
  assert.equal(await errorHead.text(), '')
  assert.equal(calls.length, 2)
  source.dispose()
})

test('cold failure returns safe 502 and Retry-After without upstream details', async () => {
  const { source } = fixture({ fetchImpl: async () => { throw new Error('secret internals') } })
  const result = await resources(source).daily(request())
  assert.equal(result.status, 502)
  assert.equal(result.headers.get('retry-after'), '60')
  assert.equal((await result.text()).includes('secret'), false)
  source.dispose()
})

test('one disconnected reader does not abort the refresh shared with another', async () => {
  const gate = deferred()
  const { source } = fixture({ fetchImpl: async url => {
    if (url.includes('HPImageArchive')) { await gate.promise; return json(archive()) }
    return jpeg()
  } })
  const api = resources(source)
  const controller = new AbortController()
  const cancelled = api.daily(request(undefined, { signal: controller.signal }))
  const active = api.daily(request())
  controller.abort()
  assert.equal((await cancelled).status, 408)
  gate.resolve()
  assert.equal((await active).status, 200)
  source.dispose()
})

test('apply uses one owned effect, unregisters all routes and aborts both markets on cleanup', async t => {
  assert.deepEqual(inject, ['webServer', 'connection'])
  const registered = new Map(), signals = []
  let cleanup, effects = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const signal = options.signal
    signals.push(signal)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const ctx = {
    on(name, listener) {
      assert.equal(name, 'webserver/index-inject')
      const table = []
      listener(table, owner())
      assert.equal(table.length, 1)
      assert.equal(table[0].kind, 'script')
      assert.equal(table[0].placement, 'body')
      assert.match(table[0].text, /data-ds-dark-theme/)
    },
    effect(fn) { effects++; cleanup = fn() },
    connection: { admit: ({ headers }) => { assert.equal(headers.get('host'), '127.0.0.1:3001'); return { peer: owner() } } },
    webServer: { register(route) {
      assert.equal(route.kind, 'exact')
      registered.set(route.path, route)
      return () => registered.delete(route.path)
    } },
  }
  apply(ctx)
  assert.equal(effects, 1)
  assert.deepEqual([...registered.keys()], [DAILY_PATH, IMAGE_PATH, DEPTH_PATH, SCENE_PATH, SHARP_ASSET_PATH, '/bing-daily-theme/api/default-settings'])
  const results = MARKETS.map(market => registered.get(DAILY_PATH).resource(
    request(`${DAILY_PATH}?market=${market}`, { headers: { host: '127.0.0.1:3001' } }),
  ))
  assert.equal(signals.length, 2)
  cleanup()
  assert.ok(signals.every(signal => signal.aborted))
  assert.equal(registered.size, 0)
  for (const result of results) assert.equal((await result).status, 502)
})

test('partial route acquisition rolls back previous registrations', () => {
  let removed = 0, count = 0
  assert.throws(() => apply({
    on() {}, effect(fn) { fn() }, connection: {},
    webServer: { register() {
      if (++count === 3) throw new Error('duplicate depth route')
      return () => { removed++ }
    } },
  }), /duplicate depth route/)
  assert.equal(removed, 2)
})

test('depth route enforces owner auth, validates queries, coalesces inference and supports GET/HEAD', async () => {
  const { source } = fixture()
  const payload = encodeDepthPayload(new Uint8Array(16).fill(180), 4, 4)
  const gate = deferred()
  let runs = 0
  let pending
  const depth = {
    available: true,
    estimate(bytes) {
      if (!pending) {
        runs++
        assert.deepEqual(bytes, JPEG)
        pending = gate.promise.then(() => payload)
      }
      return pending
    },
  }
  const api = createResources({ source, depth, admit: () => ({ peer: owner() }) })
  assert.equal((await api.depth(request(`${DEPTH_PATH}?id=${ID}`))).status, 404)
  assert.equal((await api.depth(request(`${DEPTH_PATH}?id=bad`))).status, 400)
  assert.equal((await api.depth(request(`${DEPTH_PATH}?id=${ID}`, { method: 'POST' }))).status, 405)

  const dailyWithDepth = await (await api.daily(request())).json()
  assert.equal(dailyWithDepth.parallaxAvailable, true)
  const controller = new AbortController()
  const cancelled = api.depth(request(`${DEPTH_PATH}?id=${ID}`, { signal: controller.signal }))
  const active = api.depth(request(`${DEPTH_PATH}?id=${ID}`))
  controller.abort()
  assert.equal((await cancelled).status, 408)
  gate.resolve()
  const res = await active
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/octet-stream')
  assert.equal(res.headers.get('content-length'), String(payload.byteLength))
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.match(res.headers.get('cache-control'), /^private, max-age=86400/)
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), payload)

  const head = await api.depth(request(`${DEPTH_PATH}?id=${ID}`, { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  assert.equal(runs, 1)

  const failingApi = createResources({
    source,
    depth: { available: true, async estimate() { throw new Error('model offline') } },
    admit: () => ({ peer: owner() }),
  })
  const failed = await failingApi.depth(request(`${DEPTH_PATH}?id=${ID}`))
  assert.equal(failed.status, 503)
  assert.equal(failed.headers.get('retry-after'), '60')

  const disabledApi = createResources({
    source,
    depth: { available: false, async estimate() { throw new Error('should not run') } },
    admit: () => ({ peer: owner() }),
  })
  const dailyWithoutDepth = await (await disabledApi.daily(request())).json()
  assert.equal('parallaxAvailable' in dailyWithoutDepth, false)
  assert.equal((await disabledApi.depth(request(`${DEPTH_PATH}?id=${ID}`))).status, 501)
  source.dispose()
})

test('routes forward only allowlisted markets, with domestic defaults and explicit global URLs', async () => {
  const dailyCalls = [], imageCalls = []
  const api = resources({
    async daily(market) { dailyCalls.push(market); return { market } },
    image(id, market) { imageCalls.push([id, market]); return { bytes: JPEG, contentType: 'image/jpeg' } },
  })
  for (const [query, market] of [['', 'zh-CN'], ['?market=zh-CN', 'zh-CN'], ['?market=en-US', 'en-US']]) {
    for (const method of ['GET', 'HEAD']) {
      const result = await api.daily(request(`${DAILY_PATH}${query}`, { method }))
      assert.equal(result.status, 200)
      if (method === 'GET') assert.deepEqual(await result.json(), { market })
      const imageQuery = query ? `${query}&id=${ID}` : `?id=${ID}`
      assert.equal((await api.image(request(`${IMAGE_PATH}${imageQuery}`, { method }))).status, 200)
      assert.equal(dailyCalls.at(-1), market)
      assert.deepEqual(imageCalls.at(-1), [ID, market])
    }
  }
  assert.equal(dailyCalls.length, 6)
  assert.equal(imageCalls.length, 6)
})

test('resolutions 1080p, 2k and 4k fetch their exact Bing URLs with isolated caches and strict query validation', async () => {
  const urls = []
  const source = createBingSource({
    fetchImpl: async url => {
      urls.push(url)
      if (url.includes('HPImageArchive')) return json(archive())
      const tag = url.includes('w=2560') ? 2 : url.includes('_UHD.jpg') ? 4 : 1
      return new Response(new Uint8Array([...JPEG, tag]), { headers: { 'content-type': 'image/jpeg' } })
    },
  })
  const depthPayload = encodeDepthPayload(new Uint8Array(16).fill(120), 4, 4)
  const api = createResources({
    source,
    depth: { available: true, async estimate() { return depthPayload } },
    admit: () => ({ peer: owner() }),
  })

  for (const bad of ['resolution=8k', 'resolution=UHD', 'resolution=', 'resolution=2k&resolution=4k']) {
    assert.equal((await api.daily(request(`${DAILY_PATH}?${bad}`))).status, 400, bad)
    assert.equal((await api.image(request(`${IMAGE_PATH}?${bad}&id=${ID}`))).status, 400, bad)
  }

  const d1080 = await (await api.daily(request(`${DAILY_PATH}?market=zh-CN&resolution=1080p`))).json()
  const d2k = await (await api.daily(request(`${DAILY_PATH}?market=zh-CN&resolution=2k`))).json()
  const d4k = await (await api.daily(request(`${DAILY_PATH}?market=en-US&resolution=4k`))).json()

  assert.equal(d1080.imageUrl, `${IMAGE_PATH}?id=${ID}`)
  assert.equal(d1080.resolution, undefined)
  assert.equal(d2k.imageUrl, `${IMAGE_PATH}?resolution=2k&id=${ID}`)
  assert.equal(d2k.resolution, '2k')
  assert.equal(d4k.imageUrl, `${IMAGE_PATH}?market=en-US&resolution=4k&id=${ID}`)
  assert.equal(d4k.resolution, '4k')

  const uhd = ID.replace('_1920x1080.jpg', '_UHD.jpg')
  assert.ok(urls.includes(`https://cn.bing.com/th?id=${ID}`))
  assert.ok(urls.includes(`https://cn.bing.com/th?id=${uhd}&w=2560&h=1440&rs=1&c=4`))
  assert.ok(urls.includes(`https://www.bing.com/th?id=${uhd}`))

  const b1080 = new Uint8Array(await (await api.image(request(d1080.imageUrl))).arrayBuffer())
  const b2k = new Uint8Array(await (await api.image(request(d2k.imageUrl))).arrayBuffer())
  const b4k = new Uint8Array(await (await api.image(request(d4k.imageUrl))).arrayBuffer())
  assert.equal(b1080.at(-1), 1)
  assert.equal(b2k.at(-1), 2)
  assert.equal(b4k.at(-1), 4)
  assert.equal((await api.image(request(`${IMAGE_PATH}?resolution=4k&id=${ID}`))).status, 404, 'zh-CN 4k not cached')
  assert.equal((await api.depth(request(`${DEPTH_PATH}?market=en-US&resolution=4k&id=${ID}`))).status, 200)
  source.dispose()
})

test('global metadata and bytes use only global upstream and remain inaccessible through domestic image route', async () => {
  const { source, calls } = fixture()
  const api = resources(source)
  const data = await (await api.daily(request(`${DAILY_PATH}?market=en-US`, {
    headers: { cookie: 'signed-session', authorization: 'Bearer private' },
  }))).json()
  assert.equal(data.market, 'en-US')
  assert.equal(data.imageUrl, `${IMAGE_PATH}?market=en-US&id=${ID}`)
  assert.deepEqual(calls.map(call => call.url), [GLOBAL_ARCHIVE_URL, `https://www.bing.com/th?id=${ID}`])
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'error')
    assert.deepEqual(Object.keys(init.headers), ['accept'])
  }
  assert.equal((await api.image(request(data.imageUrl))).status, 200)
  assert.equal((await api.image(request(`${IMAGE_PATH}?id=${ID}`))).status, 404)
  assert.equal(source.image(ID), undefined)
  assert.deepEqual(source.image(ID, 'en-US').bytes, JPEG)
  source.dispose()
})

test('unsupported direct source markets never fetch or expose a cached image', async () => {
  const { source, calls } = fixture()
  await source.daily()
  for (const market of [null, '', 'fr-FR', 'zh-cn', 'EN-US', '__proto__', 'https://evil.test', {}]) {
    await assert.rejects(source.daily(market), /market/)
    assert.equal(source.image(ID, market), undefined)
  }
  assert.equal(calls.length, 2)
  source.dispose()
})

test('both markets accept fixed Bing absolute and relative archive links but fetch only canonical market origin', async t => {
  for (const market of MARKETS) {
    for (const imageUrl of [`/th?id=${ID}&ignored=https://evil.test`, `th?id=${ID}`,
      `https://www.bing.com/th?id=${ID}`, `https://cn.bing.com/th?id=${ID}`,
      `//www.bing.com/th?id=${ID}`, `//cn.bing.com/th?id=${ID}`]) {
      await t.test(`${market}: ${imageUrl}`, async () => {
        const { source, calls } = fixture({ fetchImpl: async url => url.includes('HPImageArchive')
          ? (calls.push({ url }), json(archive(ID, { url: imageUrl, copyrightlink: '/search?q=wallpaper' })))
          : (calls.push({ url }), jpeg()) })
        const data = await source.daily(market)
        assert.equal(data.copyrightUrl, `${ORIGINS[market]}/search?q=wallpaper`)
        assert.equal(data.market, market)
        assert.equal(calls[0].url, market === 'zh-CN' ? ARCHIVE_URL : GLOBAL_ARCHIVE_URL)
        assert.equal(calls[1].url, `${ORIGINS[market]}/th?id=${ID}`)
        source.dispose()
      })
    }
    for (const copyrightUrl of ['https://www.bing.com/search?q=image', 'https://cn.bing.com/search?q=image']) {
      const { source } = fixture({ fetchImpl: async url => url.includes('HPImageArchive')
        ? json(archive(ID, { copyrightlink: copyrightUrl, title: null })) : jpeg() })
      const data = await source.daily(market)
      assert.equal(data.copyrightUrl, copyrightUrl)
      assert.equal(data.title, '') // Client supplies its localized fallback.
      source.dispose()
    }
  }
})

test('both markets reject unsafe archive image origins, credentials, endpoints and fragments', async t => {
  for (const market of MARKETS) for (const url of [
    `http://cn.bing.com/th?id=${ID}`, `https://cn.bing.com:444/th?id=${ID}`,
    `https://cn.bing.com.evil.test/th?id=${ID}`, `https://www.bing.com@evil.test/th?id=${ID}`,
    `https://user:pass@cn.bing.com/th?id=${ID}`, `https://user@www.bing.com/th?id=${ID}`,
    `https://evil.test/th?id=${ID}`, `https://cn.bing.com/other?id=${ID}`,
    `/th?id=${ID}#fragment`, `/th?id=${ID}&id=${ID}`,
  ]) await t.test(`${market}: ${url}`, async () => {
    let count = 0
    const { source } = fixture({ fetchImpl: async () => { count++; return json(archive(ID, { url })) } })
    await assert.rejects(source.daily(market), /Invalid Bing image/)
    assert.equal(count, 1)
    assert.equal(source.image(ID, market), undefined)
    source.dispose()
  })
})

test('unsafe copyright URLs fall back to the selected market without being fetched', async t => {
  for (const market of MARKETS) for (const copyrightlink of [
    'javascript:alert(1)', 'https://evil.test/', 'http://www.bing.com/search',
    'https://www.bing.com:444/', 'https://user:pass@cn.bing.com/search',
    'https://user@www.bing.com/search', '//evil.test/search',
  ]) await t.test(`${market}: ${copyrightlink}`, async () => {
    const { source, calls } = fixture({ fetchImpl: async url => {
      calls.push({ url })
      return url.includes('HPImageArchive') ? json(archive(ID, { copyrightlink })) : jpeg()
    } })
    const data = await source.daily(market)
    assert.equal(data.copyrightUrl, `${ORIGINS[market]}/`)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => new URL(call.url).origin === ORIGINS[market]))
    source.dispose()
  })
})

test('markets coalesce refreshes independently and maintain separate hourly freshness', async () => {
  let clock = 0
  const gates = { 'zh-CN': deferred(), 'en-US': deferred() }
  const calls = []
  const source = createBingSource({ now: () => clock, refreshMs: 100, fetchImpl: async url => {
    calls.push(url)
    const market = new URL(url).hostname === 'cn.bing.com' ? 'zh-CN' : 'en-US'
    if (url.includes('HPImageArchive')) { await gates[market].promise; return json(archive()) }
    return jpeg()
  } })
  const china = Array.from({ length: 15 }, () => source.daily())
  const global = Array.from({ length: 15 }, () => source.daily('en-US'))
  assert.deepEqual(calls, [ARCHIVE_URL, GLOBAL_ARCHIVE_URL])
  gates['zh-CN'].resolve()
  const chinaData = await Promise.all(china)
  assert.ok(chinaData.every(data => data.market === 'zh-CN'))
  assert.equal(source.image(ID, 'en-US'), undefined)
  clock = 50
  gates['en-US'].resolve()
  const globalData = await Promise.all(global)
  assert.ok(globalData.every(data => data.market === 'en-US'))
  assert.equal(calls.length, 4)
  await Promise.all([source.daily(), source.daily('en-US')])
  assert.equal(calls.length, 4)
  clock = 101
  await Promise.all([source.daily(), source.daily('en-US')])
  assert.equal(calls.length, 5)
  assert.equal(calls.at(-1), ARCHIVE_URL)
  clock = 151
  await source.daily('en-US')
  assert.equal(calls.at(-1), GLOBAL_ARCHIVE_URL)
  assert.equal(calls.length, 6) // Each market reuses only its own admitted JPEG.
  source.dispose()
})

test('cold failure and retry backoff are market-local and never fall back to the other market', async t => {
  for (const failing of MARKETS) await t.test(failing, async () => {
    const healthy = failing === 'zh-CN' ? 'en-US' : 'zh-CN'
    let clock = 0, failed = true
    const calls = []
    const source = createBingSource({ now: () => clock, refreshMs: 100, retryMs: 20, fetchImpl: async url => {
      calls.push(url)
      if (failed && new URL(url).origin === ORIGINS[failing]) throw new Error('offline')
      return url.includes('HPImageArchive') ? json(archive()) : jpeg()
    } })
    const good = await source.daily(healthy)
    await assert.rejects(source.daily(failing), /offline/)
    assert.equal(source.image(ID, failing), undefined)
    assert.equal(calls.length, 3)
    const api = resources(source)
    const result = await api.daily(request(`${DAILY_PATH}?market=${failing}`))
    assert.equal(result.status, 502)
    assert.equal((await api.image(request(`${IMAGE_PATH}?market=${failing}&id=${ID}`))).status, 404)
    assert.deepEqual(await source.daily(healthy), good)
    assert.equal(calls.length, 3)
    clock = 21; failed = false
    assert.equal((await source.daily(failing)).market, failing)
    assert.equal(calls.length, 5)
    assert.deepEqual(await source.daily(healthy), good)
    assert.equal(calls.length, 5)
    source.dispose()
  })
})

test('stale metadata and failed image publication stay in their selected market', async t => {
  for (const failing of MARKETS) await t.test(failing, async () => {
    const healthy = failing === 'zh-CN' ? 'en-US' : 'zh-CN'
    let clock = 0, generation = 0
    const calls = []
    const source = createBingSource({ now: () => clock, refreshMs: 100, retryMs: 20, fetchImpl: async url => {
      calls.push(url)
      const market = new URL(url).origin === ORIGINS[failing] ? failing : healthy
      if (url.includes('HPImageArchive')) return json(archive(generation ? OTHER_ID : ID, { title: market }))
      if (generation === 1 && market === failing) return new Response('offline', { status: 503 })
      return jpeg()
    } })
    const first = await source.daily(failing)
    await source.daily(healthy)
    clock = 101; generation = 1
    const [stale, fresh] = await Promise.all([source.daily(failing), source.daily(healthy)])
    assert.deepEqual(stale, { ...first, stale: true })
    assert.equal(stale.market, failing)
    assert.equal(fresh.market, healthy)
    assert.equal(fresh.stale, undefined)
    assert.ok(fresh.imageUrl.endsWith(OTHER_ID))
    assert.equal(source.image(OTHER_ID, failing), undefined)
    assert.ok(source.image(ID, failing))
    assert.ok(source.image(OTHER_ID, healthy))
    const before = calls.length
    clock = 110
    assert.equal((await source.daily(failing)).stale, true)
    assert.equal((await source.daily(healthy)).stale, undefined)
    assert.equal(calls.length, before)
    clock = 122; generation = 2
    assert.equal((await source.daily(failing)).stale, undefined)
    assert.equal(calls.length, before + 2)
    assert.equal((await source.daily(healthy)).stale, undefined)
    assert.equal(calls.length, before + 2)
    source.dispose()
  })
})

test('same IDs have independent bytes and independent current/previous image eviction per market', async () => {
  let clock = 0
  const ids = { 'zh-CN': ID, 'en-US': ID }
  const downloads = { 'zh-CN': 0, 'en-US': 0 }
  const source = createBingSource({ now: () => clock, refreshMs: 10, fetchImpl: async url => {
    const market = new URL(url).hostname === 'cn.bing.com' ? 'zh-CN' : 'en-US'
    if (url.includes('HPImageArchive')) return json(archive(ids[market]))
    downloads[market]++
    return new Response(new Uint8Array([...JPEG, market === 'zh-CN' ? 1 : 2]), { headers: { 'content-type': 'image/jpeg' } })
  } })
  await Promise.all(MARKETS.map(market => source.daily(market)))
  assert.notDeepEqual(source.image(ID).bytes, source.image(ID, 'en-US').bytes)
  clock = 11; await Promise.all(MARKETS.map(market => source.daily(market)))
  assert.deepEqual(downloads, { 'zh-CN': 1, 'en-US': 1 })
  clock = 22; ids['zh-CN'] = OTHER_ID; await source.daily()
  clock = 33; ids['zh-CN'] = THIRD_ID; await source.daily()
  assert.equal(source.image(ID), undefined)
  assert.ok(source.image(ID, 'en-US'))
  assert.ok(source.image(OTHER_ID))
  assert.ok(source.image(THIRD_ID))
  assert.equal(source.image(OTHER_ID, 'en-US'), undefined)
  clock = 44; ids['en-US'] = OTHER_ID; await source.daily('en-US')
  clock = 55; ids['en-US'] = THIRD_ID; await source.daily('en-US')
  assert.equal(source.image(ID, 'en-US'), undefined)
  assert.ok(source.image(OTHER_ID, 'en-US'))
  assert.ok(source.image(THIRD_ID, 'en-US'))
  assert.ok(source.image(OTHER_ID))
  assert.ok(source.image(THIRD_ID))
  assert.deepEqual(downloads, { 'zh-CN': 3, 'en-US': 3 })
  source.dispose()
})

test('dispose aborts both markets and clears both populated caches without publishing late responses', async () => {
  let clock = 0, stalled = false
  const signals = []
  const source = createBingSource({ now: () => clock, refreshMs: 10, fetchImpl: async (url, { signal }) => {
    if (!stalled) return url.includes('HPImageArchive') ? json(archive()) : jpeg()
    signals.push(signal)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  await Promise.all(MARKETS.map(market => source.daily(market)))
  clock = 11; stalled = true
  const pending = MARKETS.map(market => source.daily(market))
  assert.equal(signals.length, 2)
  source.dispose()
  source.dispose() // Idempotent cleanup.
  assert.ok(signals.every(signal => signal.aborted))
  await Promise.all(pending.map(promise => assert.rejects(promise, /disposed/)))
  for (const market of MARKETS) {
    assert.equal(source.image(ID, market), undefined)
    await assert.rejects(source.daily(market), /disposed/)
  }
})
