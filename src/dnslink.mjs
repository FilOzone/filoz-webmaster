const API = 'https://api.cloudflare.com/client/v4'
const PREFIX = '_dnslink.'
const TTL = 300

export function recordName(name) {
  const host = name.trim().toLowerCase()
  return host.startsWith(PREFIX) ? host : `${PREFIX}${host}`
}

export function parseDnslink(content) {
  return /dnslink=\/ipfs\/([A-Za-z0-9]+)/.exec(content ?? '')?.[1] ?? null
}

async function call({ token, zoneId }, path, init = {}) {
  const res = await fetch(`${API}/zones/${zoneId}/dns_records${path}`, {
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
  const query = new URLSearchParams({ type: 'TXT', 'name.exact': fqdn })
  const records = await call(cloudflare, `?${query}`)
  const links = records.filter((record) => /dnslink=/.test(record.content ?? ''))
  if (links.length > 1) throw new Error(`${fqdn} has ${links.length} DNSLink TXT records, expected one`)
  const [record] = links
  return { fqdn, recordId: record?.id ?? null, cid: parseDnslink(record?.content) }
}

export async function writeDnslink({ fqdn, recordId }, cid, cloudflare) {
  const body = JSON.stringify({ type: 'TXT', name: fqdn, content: `"dnslink=/ipfs/${cid}"`, ttl: TTL })
  const record =
    recordId == null
      ? await call(cloudflare, '', { method: 'POST', body })
      : await call(cloudflare, `/${recordId}`, { method: 'PATCH', body })
  if (parseDnslink(record?.content) !== cid) {
    throw new Error(`DNSLink update accepted but ${fqdn} names ${parseDnslink(record?.content)}`)
  }
}
