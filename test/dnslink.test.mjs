import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDnslink, readDnslink, recordName, writeDnslink } from '../src/dnslink.mjs'

const OLD = 'bafybeiejj36bzjhxsyskh7euss45u2p45ifcheqzw2i5fbimybd4kmu3jq'
const NEW = 'bafybeia2fkkw247fsvhir3qvkkuxwcqprmxw6mxetdhmmrjmyrb3zktmqm'
const NAME = '_dnslink.site.example.com'
const TOKEN = 'cf-token-7f3a91'
const CLOUDFLARE = { token: TOKEN, zoneId: 'z' }

function reply(status, body) {
  return { ok: status < 400, status, json: async () => body }
}

function fakeCloudflare(t, initial) {
  const records = initial.map((record, index) => ({ id: `r${index + 1}`, type: 'TXT', ttl: 300, ...record }))
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const { pathname, searchParams } = new URL(url)
    const method = init.method ?? 'GET'
    calls.push({ method, pathname, auth: init.headers.authorization })
    let result
    if (method === 'GET') {
      result = records.filter((record) => record.name === searchParams.get('name.exact'))
    } else if (method === 'POST') {
      result = { id: `r${records.length + 1}`, ...JSON.parse(init.body) }
      records.push(result)
    } else {
      const id = pathname.split('/dns_records/')[1]
      result = Object.assign(records.find((record) => record.id === id), JSON.parse(init.body))
    }
    return reply(200, { success: true, result })
  })
  return { records, calls }
}

test('adds the _dnslink label when it is missing', () => {
  assert.equal(recordName('Site.Example.com'), NAME)
  assert.equal(recordName(NAME), NAME)
})

test('reads a CID out of quoted and bare TXT content', () => {
  assert.equal(parseDnslink(`"dnslink=/ipfs/${OLD}"`), OLD)
  assert.equal(parseDnslink(`dnslink=/ipfs/${OLD}/index.html`), OLD)
  assert.equal(parseDnslink('"v=spf1 -all"'), null)
  assert.equal(parseDnslink(undefined), null)
})

test('reports no record and no CID when the name has no DNSLink', async (t) => {
  fakeCloudflare(t, [{ name: NAME, content: '"v=spf1 -all"' }])
  assert.deepEqual(await readDnslink('site.example.com', CLOUDFLARE), { fqdn: NAME, recordId: null, cid: null })
})

test('sends the token as a bearer header', async (t) => {
  const { calls } = fakeCloudflare(t, [])
  await readDnslink(NAME, CLOUDFLARE)
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`)
})

test('updates the existing record in place', async (t) => {
  const { records, calls } = fakeCloudflare(t, [{ name: NAME, content: `"dnslink=/ipfs/${OLD}"` }])
  const link = await readDnslink('site.example.com', CLOUDFLARE)
  assert.equal(link.cid, OLD)
  await writeDnslink(link, NEW, CLOUDFLARE)
  assert.deepEqual(records.map((record) => record.content), [`"dnslink=/ipfs/${NEW}"`])
  assert.deepEqual(calls.map((entry) => entry.method), ['GET', 'PATCH'])
  assert.equal(calls[1].pathname, '/client/v4/zones/z/dns_records/r1')
})

test('creates the record when the name has none', async (t) => {
  const { records, calls } = fakeCloudflare(t, [])
  await writeDnslink(await readDnslink(NAME, CLOUDFLARE), NEW, CLOUDFLARE)
  assert.deepEqual(records.map((record) => [record.name, record.content]), [[NAME, `"dnslink=/ipfs/${NEW}"`]])
  assert.deepEqual(calls.map((entry) => entry.method), ['GET', 'POST'])
})

test('refuses a name with two DNSLink records', async (t) => {
  fakeCloudflare(t, [
    { name: NAME, content: `"dnslink=/ipfs/${OLD}"` },
    { name: NAME, content: `"dnslink=/ipfs/${NEW}"` },
  ])
  await assert.rejects(readDnslink(NAME, CLOUDFLARE), /2 DNSLink TXT records/)
})

test('surfaces a Cloudflare error with its code and without the token', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    reply(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
  )
  await assert.rejects(readDnslink(NAME, CLOUDFLARE), (error) => {
    assert.match(error.message, /Cloudflare GET answered 403: 10000 Authentication error/)
    assert.ok(!error.message.includes(TOKEN))
    return true
  })
})

test('fails when Cloudflare stores something other than the CID asked for', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    reply(200, { success: true, result: { id: 'r1', name: NAME, content: `"dnslink=/ipfs/${OLD}"` } }),
  )
  await assert.rejects(writeDnslink({ fqdn: NAME, recordId: 'r1' }, NEW, CLOUDFLARE), /DNSLink update accepted but/)
})
