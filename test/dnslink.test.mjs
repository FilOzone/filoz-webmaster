import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDnslink, parseDnslink, readDnslink, recordName, writeDnslink } from '../src/dnslink.mjs'

const OLD = 'bafybeiejj36bzjhxsyskh7euss45u2p45ifcheqzw2i5fbimybd4kmu3jq'
const NEW = 'bafybeia2fkkw247fsvhir3qvkkuxwcqprmxw6mxetdhmmrjmyrb3zktmqm'
const NAME = '_dnslink.site.example.com'

function fakeCloudflare(initial) {
  const records = initial.map((record, index) => ({ id: `r${index + 1}`, type: 'TXT', ttl: 300, ...record }))
  const calls = []
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url)
    const method = init.method ?? 'GET'
    calls.push({ method, pathname, auth: init.headers.authorization })
    const id = pathname.split('/dns_records/')[1]
    let result
    if (method === 'GET') {
      result = records.filter((record) => record.name === searchParams.get('name.exact'))
    } else if (method === 'POST') {
      result = { id: `r${records.length + 1}`, ...JSON.parse(init.body) }
      records.push(result)
    } else {
      result = Object.assign(records.find((record) => record.id === id), JSON.parse(init.body))
    }
    return { ok: true, status: 200, json: async () => ({ success: true, result }) }
  }
  return { cloudflare: { token: 't', zoneId: 'z', fetchImpl }, records, calls }
}

test('adds the _dnslink label when it is missing', () => {
  assert.equal(recordName('Site.Example.com.'), NAME)
  assert.equal(recordName(NAME), NAME)
  assert.throws(() => recordName(' '))
})

test('reads a CID out of quoted and bare TXT content', () => {
  assert.equal(parseDnslink(`"dnslink=/ipfs/${OLD}"`), OLD)
  assert.equal(parseDnslink(`dnslink=/ipfs/${OLD}/index.html`), OLD)
  assert.equal(parseDnslink('"v=spf1 -all"'), null)
  assert.equal(parseDnslink(undefined), null)
})

test('writes TXT content as a quoted string', () => {
  assert.equal(formatDnslink(NEW), `"dnslink=/ipfs/${NEW}"`)
})

test('reports no record and no CID when the name has no DNSLink', async () => {
  const { cloudflare } = fakeCloudflare([{ name: NAME, content: '"v=spf1 -all"' }])
  assert.deepEqual(await readDnslink('site.example.com', cloudflare), { fqdn: NAME, recordId: null, cid: null })
})

test('updates the existing record in place', async () => {
  const { cloudflare, records, calls } = fakeCloudflare([{ name: NAME, content: `"dnslink=/ipfs/${OLD}"` }])
  const link = await readDnslink('site.example.com', cloudflare)
  assert.equal(link.cid, OLD)
  assert.equal(await writeDnslink(link, NEW, cloudflare), 'r1')
  assert.equal(records.length, 1)
  assert.equal(records[0].content, `"dnslink=/ipfs/${NEW}"`)
  assert.deepEqual(calls.map((entry) => entry.method), ['GET', 'PATCH'])
  assert.equal(calls[1].pathname, '/client/v4/zones/z/dns_records/r1')
  assert.equal((await readDnslink(NAME, cloudflare)).cid, NEW)
  assert.equal(calls[1].auth, 'Bearer t')
})

test('creates the record when the name has none', async () => {
  const { cloudflare, records, calls } = fakeCloudflare([])
  assert.equal(await writeDnslink(await readDnslink(NAME, cloudflare), NEW, cloudflare), 'r1')
  assert.deepEqual(records.map((record) => [record.name, record.content]), [[NAME, `"dnslink=/ipfs/${NEW}"`]])
  assert.deepEqual(calls.map((entry) => entry.method), ['GET', 'POST'])
})

test('refuses a name with two DNSLink records', async () => {
  const { cloudflare } = fakeCloudflare([
    { name: NAME, content: `"dnslink=/ipfs/${OLD}"` },
    { name: NAME, content: `"dnslink=/ipfs/${NEW}"` },
  ])
  await assert.rejects(readDnslink(NAME, cloudflare), /2 DNSLink TXT records/)
})

test('surfaces a Cloudflare error with its code', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
  })
  await assert.rejects(
    readDnslink(NAME, { token: 't', zoneId: 'z', fetchImpl }),
    /Cloudflare GET answered 403: 10000 Authentication error/,
  )
})

test('fails when Cloudflare stores something other than the CID asked for', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, result: { id: 'r1', name: NAME, content: `"dnslink=/ipfs/${OLD}"` } }),
  })
  await assert.rejects(
    writeDnslink({ fqdn: NAME, recordId: 'r1' }, NEW, { token: 't', zoneId: 'z', fetchImpl }),
    /DNSLink update accepted but/,
  )
})
