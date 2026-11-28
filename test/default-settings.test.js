import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { createDefaultSettingsHandler } from '../src/server/default-settings.js'

test('profile defaults survive restart, are isolated by profile, and require an owner', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bdt-defaults-'))
  const other = await mkdtemp(join(tmpdir(), 'bdt-defaults-'))
  t.after(() => Promise.all([dir, other].map(path => rm(path, { recursive: true, force: true }))))
  const owner = { peer: { principal: { kind: 'owner' }, signal: new AbortController().signal } }
  async function request(method, body, { profile = dir, admission = owner, type = 'application/json' } = {}) {
    const req = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method, headers: { 'content-type': type } })
    const res = {
      setHeader() {}, writeHead(status) { this.status = status }, end(json) { this.value = JSON.parse(json) },
    }
    await createDefaultSettingsHandler(profile, () => admission)(req, res)
    return res
  }
  const settings = { enabled: false, weather: { location: 'Shanghai' }, leftSidebar: { tint: true } }
  assert.equal((await request('GET')).value, null)
  assert.equal((await request('PUT', JSON.stringify(settings))).status, 200)
  assert.equal((await request('GET', null, { profile: other })).value, null)
  for (const method of ['GET', 'PUT']) {
    assert.equal((await request(method, '{}', { admission: { rejection: 401 } })).status, 401)
    assert.equal((await request(method, '{}', { admission: { peer: { ...owner.peer, principal: { kind: 'guest' } } } })).status, 403)
  }
  assert.equal((await request('POST')).status, 405)
  assert.equal((await request('PUT', '{}', { type: 'text/plain' })).status, 415)
  for (const input of ['null', 'bad', '[]', '{}']) assert.equal((await request('PUT', input)).status, 400)
  assert.equal((await request('PUT', 'x'.repeat(32769))).status, 413)
  assert.deepEqual((await request('GET')).value, settings)
})
