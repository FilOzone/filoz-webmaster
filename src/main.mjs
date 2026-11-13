import { appendFileSync } from 'node:fs'
import { packDirectory } from './car.mjs'
import { readDnslink, writeDnslink } from './dnslink.mjs'
import { readContenthash, writeContenthash } from './ens.mjs'
import { upload, verifyRetrieval } from './upload.mjs'

const log = (line) => console.log(line)

function input(name, fallback = '') {
  const value = process.env[`WEBMASTER_${name}`]
  return value == null || value === '' ? fallback : value
}

function output(values) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''))
}

function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, `${lines.join('\n')}\n`)
}

async function main() {
  const path = input('PATH')
  const ensName = input('ENS_NAME')
  const dnslinkName = input('DNSLINK_NAME')
  const cloudflare = { token: input('CLOUDFLARE_API_TOKEN'), zoneId: input('CLOUDFLARE_ZONE_ID') }
  const network = input('NETWORK', 'mainnet')
  const copies = Number(input('COPIES', '2'))
  const ethRpcUrl = input('ETH_RPC_URL', 'https://ethereum-rpc.publicnode.com')
  const timeoutMs = Number(input('VERIFY_TIMEOUT', '600')) * 1000
  const dryRun = input('DRY_RUN', 'false') === 'true'
  const rawKey = input('PRIVATE_KEY')
  const privateKey = rawKey === '' || rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`

  if (path === '') throw new Error('path is required')

  const useEns = ensName !== ''
  const canReadDnslink = cloudflare.token !== '' && cloudflare.zoneId !== ''
  if (dnslinkName !== '' && !canReadDnslink && !dryRun) {
    throw new Error('dnslink-name needs cloudflare-api-token and cloudflare-zone-id')
  }
  const useDnslink = dnslinkName !== '' && canReadDnslink

  const { rootCid, car, files } = await packDirectory(path)
  log(`Packed ${files} files, ${car.length} bytes`)
  log(`Root CID: ${rootCid}`)

  const previousCid = useEns ? ((await readContenthash(ensName, ethRpcUrl)) ?? '') : ''
  if (useEns) log(`${ensName} currently points at ${previousCid || 'nothing'}`)

  const dnslink = useDnslink ? await readDnslink(dnslinkName, cloudflare) : null
  const dnslinkPreviousCid = dnslink?.cid ?? ''
  if (useDnslink) log(`${dnslink.fqdn} currently names ${dnslinkPreviousCid || 'nothing'}`)
  if (dnslinkName !== '' && !useDnslink) log(`Dry run without Cloudflare credentials, not reading ${dnslinkName}`)

  const ensCurrent = useEns && previousCid === rootCid
  const dnslinkCurrent = useDnslink && dnslinkPreviousCid === rootCid
  const targets = [
    ...(useEns ? [ensCurrent] : []),
    ...(dnslinkName !== '' ? [dnslinkCurrent] : []),
  ]
  const previous = { 'previous-cid': previousCid, 'dnslink-previous-cid': dnslinkPreviousCid }

  if (targets.length > 0 && targets.every(Boolean)) {
    log('Content unchanged, nothing to publish')
    output({ cid: rootCid, ...previous, changed: 'false' })
    summary([`Already pointing at \`${rootCid}\`. Nothing published.`])
    return
  }

  if (dryRun) {
    log('Dry run, stopping before upload')
    output({ cid: rootCid, ...previous, changed: 'false' })
    return
  }

  if (privateKey === '') throw new Error('private-key is required')

  const stored = await upload({ car, rootCid, privateKey, network, copies, log })
  if (stored.uploaded) log(`Piece CID: ${stored.pieceCid}`)
  for (const failure of stored.failed) log(`Provider ${failure.providerId} failed: ${failure.error}`)

  const served = await verifyRetrieval({ rootCid, copies: stored.copies, timeoutMs, log })

  if (useDnslink && !dnslinkCurrent) {
    await writeDnslink(dnslink, rootCid, cloudflare)
    log(`${dnslink.fqdn} now names ${rootCid}`)
  }

  let ensTx = ''
  if (useEns && !ensCurrent) {
    ensTx = await writeContenthash(ensName, rootCid, privateKey, ethRpcUrl)
    log(`${ensName} now points at ${rootCid} (${ensTx})`)
  }

  output({
    cid: rootCid,
    ...previous,
    'piece-cid': stored.pieceCid,
    'ens-tx': ensTx,
    changed: 'true',
  })
  summary([
    `**Published** \`${rootCid}\``,
    '',
    ...(stored.uploaded ? [`- Piece: \`${stored.pieceCid}\``] : ['- Already stored, upload skipped']),
    `- Copies: ${stored.copies.map((copy) => `provider ${copy.providerId} (data set ${copy.dataSetId})`).join(', ')}`,
    `- Retrieval verified on: ${served.map((id) => `provider ${id}`).join(', ')}`,
    ...(useDnslink && !dnslinkCurrent
      ? [`- ${dnslink.fqdn}: \`${dnslinkPreviousCid || 'none'}\` to \`${rootCid}\``]
      : []),
    ...(useEns && !ensCurrent
      ? [`- ${ensName}: \`${previousCid || 'none'}\` to \`${rootCid}\`, transaction \`${ensTx}\``]
      : []),
  ])
}

main().catch((error) => {
  console.error(`::error::${error.message}`)
  process.exitCode = 1
})
