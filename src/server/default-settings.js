import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_BYTES = 32 * 1024

export function createDefaultSettingsHandler(profileDir, admit) {
  const file = profileDir && join(profileDir, 'bing-daily-theme.defaults.json')
  return async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })
      res.end(JSON.stringify(value))
    }
    try {
      const admission = admit(req)
      if ('rejection' in admission) return reply(admission.rejection, null)
      const { peer } = admission
      if (peer.signal.aborted) return reply(401, null)
      if (peer.principal.kind !== 'owner') return reply(403, null)
      if (!file) return reply(503, null)
      if (req.method === 'GET') {
        try { return reply(200, JSON.parse(await readFile(file, 'utf8'))) }
        catch (error) {
          if (error.code === 'ENOENT') return reply(200, null)
          throw error
        }
      }
      if (req.method !== 'PUT') {
        res.setHeader('allow', 'GET, PUT')
        return reply(405, null)
      }
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reply(415, null)
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_BYTES) return reply(413, null)
        chunks.push(chunk)
      }
      let settings
      try { settings = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { return reply(400, null) }
      if (typeof settings?.enabled !== 'boolean') return reply(400, null)
      const temporary = file + '.' + randomUUID()
      try {
        await writeFile(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' })
        if (peer.signal.aborted) return reply(401, null)
        await rename(temporary, file)
      } finally { await rm(temporary, { force: true }) }
      return reply(200, settings)
    } catch { return reply(503, null) }
  }
}
