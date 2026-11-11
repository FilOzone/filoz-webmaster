import { appendFileSync } from 'node:fs'
import { packDirectory } from './car.mjs'
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
  const network = input('NETWORK', 'mainnet')
  const copies = Number(input('COPIES', '2'))
  const ethRpcUrl = input('ETH_RPC_URL', 'https://ethereum-rpc.publicnode.com')
  const timeoutMs = Number(input('VERIFY_TIMEOUT', '600')) * 1000
  const dryRun = input('DRY_RUN', 'false') === 'true'
  const rawKey = input('PRIVATE_KEY')
  const privateKey = rawKey === '' || rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`

  if (path === '') throw new Error('path is required')

  const { rootCid, car, files } = await packDirectory(path)
  log(`Packed ${files} files, ${car.length} bytes`)
  log(`Root CID: ${rootCid}`)

  const previousCid = ensName === '' ? '' : ((await readContenthash(ensName, ethRpcUrl)) ?? '')
  if (ensName !== '') log(`${ensName} currently points at ${previousCid || 'nothing'}`)

  if (ensName !== '' && previousCid === rootCid) {
    log('Content unchanged, nothing to publish')
    output({ cid: rootCid, 'previous-cid': previousCid, changed: 'false' })
    summary([`**${ensName}** already points at \`${rootCid}\`. Nothing published.`])
    return
  }

  if (dryRun) {
    log('Dry run, stopping before upload')
    output({ cid: rootCid, 'previous-cid': previousCid, changed: 'false' })
    return
  }

  if (privateKey === '') throw new Error('private-key is required')

  const stored = await upload({ car, rootCid, privateKey, network, copies, log })
  log(`Piece CID: ${stored.pieceCid}`)
  for (const failure of stored.failed) log(`Provider ${failure.providerId} failed: ${failure.error}`)

  const served = await verifyRetrieval({ rootCid, copies: stored.copies, timeoutMs, log })

  let ensTx = ''
  if (ensName !== '') {
    ensTx = await writeContenthash(ensName, rootCid, privateKey, ethRpcUrl)
    log(`${ensName} now points at ${rootCid} (${ensTx})`)
  }

  output({
    cid: rootCid,
    'previous-cid': previousCid,
    'piece-cid': stored.pieceCid,
    'ens-tx': ensTx,
    changed: 'true',
  })
  summary([
    `**Published** \`${rootCid}\``,
    '',
    `- Piece: \`${stored.pieceCid}\``,
    `- Copies: ${stored.copies.map((copy) => `provider ${copy.providerId} (data set ${copy.dataSetId})`).join(', ')}`,
    `- Retrieval verified on: ${served.map((id) => `provider ${id}`).join(', ')}`,
    ...(ensName === '' ? [] : [`- ${ensName}: \`${previousCid || 'none'}\` to \`${rootCid}\`, transaction \`${ensTx}\``]),
  ])
}

main().catch((error) => {
  console.error(`::error::${error.message}`)
  process.exitCode = 1
})
