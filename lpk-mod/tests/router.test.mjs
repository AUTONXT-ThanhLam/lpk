import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRouter } from '../bin/lpk-router.mjs'

const listen = (server) => new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)))

const upstream = (seen) =>
  http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
      res.setHeader('content-type', 'text/event-stream')
      res.setHeader('anthropic-ratelimit-unified-5h-utilization', '0.40')
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
      res.end()
    })
  })

const post = (port, model, headers = {}) =>
  new Promise((done, fail) => {
    const body = JSON.stringify({ model, max_tokens: 1, messages: [] })
    const req = http.request(
      { host: '127.0.0.1', port, path: '/v1/messages?beta=true', method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = ''
        res.on('data', (d) => (text += d))
        res.on('end', () => done({ status: res.statusCode, text }))
      },
    )
    req.on('error', fail)
    req.end(body)
  })

let dir, anthropicSeen, deepseekSeen, servers, port, logFile

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lpk-router-'))
  anthropicSeen = []
  deepseekSeen = []
  const anthropic = upstream(anthropicSeen)
  const deepseek = upstream(deepseekSeen)
  const aPort = await listen(anthropic)
  const dPort = await listen(deepseek)
  writeFileSync(join(dir, 'cc1.token'), 'tok-account-one\n')
  writeFileSync(join(dir, 'cc2.token'), 'tok-account-two\n')
  writeFileSync(join(dir, 'active'), 'cc1\n')
  writeFileSync(join(dir, 'deepseek.key'), 'sk-deepseek-key\n')
  logFile = join(dir, 'router.log')
  const router = createRouter({
    accountsDir: dir,
    deepseekKeyFile: join(dir, 'deepseek.key'),
    deepseekUrl: `http://127.0.0.1:${dPort}/anthropic`,
    anthropicUrl: `http://127.0.0.1:${aPort}`,
    logFile,
  })
  port = await listen(router)
  servers = [anthropic, deepseek, router]
})

after(() => {
  for (const s of servers) s.close()
  rmSync(dir, { recursive: true })
})

test('a Claude request carries the active account, and flipping the account moves the next request', async () => {
  anthropicSeen.length = 0
  await post(port, 'claude-sonnet-5-5', { authorization: 'Bearer placeholder', 'anthropic-beta': 'oauth-2025-04-20' })
  writeFileSync(join(dir, 'active'), 'cc2\n')
  await post(port, 'claude-sonnet-5-5', { authorization: 'Bearer placeholder' })
  assert.deepEqual(
    anthropicSeen.map((r) => r.headers.authorization),
    ['Bearer tok-account-one', 'Bearer tok-account-two'],
  )
  assert.equal(anthropicSeen[0].headers['anthropic-beta'], 'oauth-2025-04-20')
  writeFileSync(join(dir, 'active'), 'cc1\n')
})

test('a deepseek request reaches DeepSeek with its key alone, never a Claude credential', async () => {
  anthropicSeen.length = 0
  deepseekSeen.length = 0
  const r = await post(port, 'deepseek-flash', {
    authorization: 'Bearer placeholder',
    'x-api-key': 'sk-ant-client',
    'anthropic-beta': 'oauth-2025-04-20',
    cookie: 'session=1',
    'anthropic-version': '2023-06-01',
  })
  assert.equal(r.status, 200)
  assert.equal(anthropicSeen.length, 0)
  assert.equal(deepseekSeen.length, 1)
  const sent = deepseekSeen[0]
  assert.equal(sent.url, '/anthropic/v1/messages?beta=true')
  assert.equal(sent.headers['x-api-key'], 'sk-deepseek-key')
  for (const h of ['authorization', 'anthropic-beta', 'cookie']) assert.equal(sent.headers[h], undefined, h)
  assert.equal(JSON.parse(sent.body).model, 'deepseek-flash')
})

test('without a DeepSeek key the request fails at the router and goes nowhere', async () => {
  deepseekSeen.length = 0
  const key = readFileSync(join(dir, 'deepseek.key'), 'utf8')
  writeFileSync(join(dir, 'deepseek.key'), '')
  const r = await post(port, 'deepseek-flash')
  writeFileSync(join(dir, 'deepseek.key'), key)
  assert.equal(r.status, 502)
  assert.match(r.text, /no DeepSeek key/)
  assert.equal(deepseekSeen.length, 0)
})

test('the log names the account and the quota headers and holds no token', async () => {
  const log = readFileSync(logFile, 'utf8')
  assert.match(log, /upstream=anthropic account=cc1 model=claude-sonnet-5-5 .*status=200 rl-5h-utilization=0.40/)
  assert.match(log, /upstream=anthropic account=cc2/)
  assert.match(log, /upstream=deepseek model=deepseek-flash/)
  for (const secret of ['tok-account-one', 'tok-account-two', 'sk-deepseek-key']) assert.equal(log.includes(secret), false, secret)
})
