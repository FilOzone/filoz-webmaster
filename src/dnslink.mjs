import { CID } from 'multiformats/cid'

const API = 'https://api.cloudflare.com/client/v4'
const PREFIX = '_dnslink.'
const TTL = 300

export function recordName(name) {
  const host = name.trim().toLowerCase().replace(/\.$/, '')
  if (host === '' || host === PREFIX.slice(0, -1)) throw new Error(`Not a DNS name: ${name}`)
  return host.startsWith(PREFIX) ? host : `${PREFIX}${host}`
}

export function parseDnslink(content) {
  const match = /dnslink=\/ipfs\/([A-Za-z0-9]+)/.exec(content ?? '')
  if (match == null) return null
  try {
    return CID.parse(match[1]).toV1().toString()
  } catch {
    return match[1]
  }
}

export function formatDnslink(cid) {
  return `"dnslink=/ipfs/${CID.parse(cid).toV1().toString()}"`
}

async function call({ token, zoneId, fetchImpl = fetch }, path, init = {}) {
  const res = await fetchImpl(`${API}/zones/${zoneId}/dns_records${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success !== true) {
    const detail = (body.errors ?? []).map((error) => `${error.code} ${error.message}`).join(', ')
    throw new Error(`Cloudflare ${init.method ?? 'GET'} answered ${res.status}${detail === '' ? '' : `: ${detail}`}`)
  }
  return body.result
}

export async function readDnslink(name, cloudflare) {
  const fqdn = recordName(name)
  const query = new URLSearchParams({ type: 'TXT', 'name.exact': fqdn, per_page: '100' })
  const records = await call(cloudflare, `?${query}`)
  const links = records.filter((record) => record.name.toLowerCase() === fqdn && /dnslink=/.test(record.content ?? ''))
  if (links.length > 1) throw new Error(`${fqdn} has ${links.length} DNSLink TXT records, expected one`)
  const [record] = links
  return { fqdn, recordId: record?.id ?? null, cid: parseDnslink(record?.content) }
}

export async function writeDnslink({ fqdn, recordId }, cid, cloudflare) {
  const want = CID.parse(cid).toV1().toString()
  const body = JSON.stringify({ type: 'TXT', name: fqdn, content: formatDnslink(want), ttl: TTL })
  const record =
    recordId == null
      ? await call(cloudflare, '', { method: 'POST', body })
      : await call(cloudflare, `/${recordId}`, { method: 'PATCH', body })
  if (parseDnslink(record?.content) !== want) {
    throw new Error(`DNSLink update accepted but ${fqdn} names ${parseDnslink(record?.content)}`)
  }
  return record.id
}
