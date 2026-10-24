import http from 'node:http'
import https from 'node:https'
import { readFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'

const CONFIG = join(homedir(), '.config', 'lpk')

export function readText(file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

export function activeAccount(dir) {
  const id = readText(join(dir, 'active')) || 'cc1'
  return { id, token: readText(join(dir, `${id}.token`)) }
}

const CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'anthropic-beta', 'cookie', 'proxy-authorization']
const HOP_HEADERS = ['host', 'content-length', 'accept-encoding', 'connection', 'transfer-encoding']
const SEEN_HEADERS = ['anthropic-ratelimit-unified-status', 'anthropic-ratelimit-unified-5h-utilization', 'anthropic-ratelimit-unified-7d-utilization']

export function modelOf(body) {
  try {
    const model = JSON.parse(body.toString()).model
    return typeof model === 'string' ? model : null
  } catch {
    return null
  }
}

export function plan(model, env) {
  if (model && model.startsWith('deepseek-')) {
    const key = readText(env.deepseekKeyFile)
    if (!key) return { error: `no DeepSeek key in ${env.deepseekKeyFile}` }
    const url = new URL(env.deepseekUrl)
    return { upstream: 'deepseek', url, basePath: url.pathname.replace(/\/$/, ''), keep: ['anthropic-version'], auth: { 'x-api-key': key } }
  }
  const account = activeAccount(env.accountsDir)
  if (!account.token) return { error: `account ${account.id} has no token` }
  const url = new URL(env.anthropicUrl)
  return { upstream: 'anthropic', account: account.id, url, basePath: '', keepAll: true, auth: { authorization: `Bearer ${account.token}` } }
}

export function forwardHeaders(incoming, target, length) {
  const out = {}
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase()
    if (HOP_HEADERS.includes(lower) || CREDENTIAL_HEADERS.includes(lower)) {
      if (lower === 'anthropic-beta' && target.keepAll) out[lower] = value
      continue
    }
    if (target.keepAll || target.keep.includes(lower) || lower === 'content-type') out[lower] = value
  }
  return { ...out, ...target.auth, host: target.url.host, 'content-length': length }
}

const USAGE_FIELDS = { input_tokens: 'in', cache_read_input_tokens: 'cache_read', cache_creation_input_tokens: 'cache_write', output_tokens: 'out' }
const JSON_CAP = 4 * 1024 * 1024

export function usageTap(contentType) {
  const streamed = String(contentType || '').includes('text/event-stream')
  const buffered = String(contentType || '').includes('json')
  const usage = {}
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const take = (u) => {
    for (const [from, to] of Object.entries(USAGE_FIELDS)) if (u && typeof u[from] === 'number') usage[to] = u[from]
  }
  const read = (text) => {
    try {
      const d = JSON.parse(text)
      take(d.message?.usage)
      take(d.usage)
    } catch {
      return
    }
  }
  return {
    push(buffer) {
      const chunk = decoder.write(buffer)
      if (!streamed) {
        if (buffered && pending.length < JSON_CAP) pending += chunk
        return
      }
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      for (const l of lines) if (l.startsWith('data:') && l.includes('"usage"')) read(l.slice(5))
    },
    fields() {
      if (!streamed) read(pending)
      else if (pending.startsWith('data:') && pending.includes('"usage"')) read(pending.slice(5))
      return usage
    },
  }
}

export function createRouter(env) {
  const record = (fields) => {
    if (!env.logFile) return
    mkdirSync(dirname(env.logFile), { recursive: true })
    appendFileSync(env.logFile, `${Object.entries({ ...fields, ts: new Date().toISOString() }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(' ')}\n`)
  }
  return http.createServer((req, res) => {
    if (req.url === '/__lpk_router') {
      res.end('ok')
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const model = modelOf(body)
      const target = plan(model, env)
      if (target.error) {
        record({ model, error: target.error })
        res.statusCode = 502
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `lpk-router: ${target.error}` } }))
        return
      }
      const mod = target.url.protocol === 'https:' ? https : http
      const up = mod.request(
        { host: target.url.hostname, port: target.url.port || (mod === https ? 443 : 80), path: target.basePath + req.url, method: req.method, headers: forwardHeaders(req.headers, target, body.length) },
        (r) => {
          const seen = Object.fromEntries(SEEN_HEADERS.map((h) => [h.replace('anthropic-ratelimit-unified-', 'rl-'), r.headers[h]]))
          const tap = usageTap(r.headers['content-type'])
          let logged = false
          const finish = () => {
            if (logged) return
            logged = true
            record({ upstream: target.upstream, account: target.account, model, path: req.url.split('?')[0], status: r.statusCode, ...seen, ...tap.fields() })
          }
          r.on('data', (c) => tap.push(c))
          r.on('end', finish)
          r.on('close', finish)
          r.on('error', () => res.destroy())
          res.on('close', finish)
          res.writeHead(r.statusCode, r.headers)
          r.pipe(res)
        },
      )
      up.on('error', (e) => {
        record({ upstream: target.upstream, model, error: e.code || e.message })
        res.statusCode = 502
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `lpk-router: ${e.code || e.message}` } }))
      })
      up.end(body)
    })
  })
}

export function envFromProcess(e = process.env) {
  return {
    accountsDir: e.LPK_ACCOUNTS_DIR || join(CONFIG, 'accounts'),
    deepseekKeyFile: e.LPK_DEEPSEEK_KEY_FILE || join(CONFIG, 'deepseek.key'),
    deepseekUrl: e.LPK_DEEPSEEK_URL || 'https://api.deepseek.com/anthropic',
    anthropicUrl: e.LPK_ANTHROPIC_URL || 'https://api.anthropic.com',
    logFile: e.LPK_ROUTER_LOG || join(CONFIG, 'router.log'),
    port: Number(e.LPK_ROUTER_PORT || 18766),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const env = envFromProcess()
  createRouter(env).listen(env.port, '127.0.0.1')
}
