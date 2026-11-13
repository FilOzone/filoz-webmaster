import { Synapse, calibration, mainnet } from '@filoz/synapse-sdk'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const CHAINS = { mainnet, calibration }

function serves(url) {
  return fetch(url, { signal: AbortSignal.timeout(30_000) })
    .then((res) => res.ok)
    .catch(() => false)
}

export async function upload({ car, rootCid, privateKey, network, copies, log }) {
  const chain = CHAINS[network]
  if (chain == null) throw new Error(`Unknown network: ${network}`)

  const synapse = Synapse.create({
    account: privateKeyToAccount(privateKey),
    chain,
    source: 'filoz-webmaster',
  })

  const contexts = await synapse.storage.createContexts({
    copies,
    metadata: { withIPFSIndexing: '' },
  })

  const held = contexts.map((context) => ({
    providerId: context.provider.id.toString(),
    dataSetId: context.dataSetId?.toString() ?? '',
    origin: new URL(context.provider.pdp.serviceURL).origin,
  }))
  const present = await Promise.all(
    held.map((copy) => copy.dataSetId !== '' && serves(`${copy.origin}/ipfs/${rootCid}/`)),
  )
  if (present.every(Boolean)) {
    log(`Already served by ${held.map((copy) => `provider ${copy.providerId}`).join(', ')}, not uploading again`)
    return { pieceCid: '', uploaded: false, copies: held, failed: [] }
  }

  const prepared = await synapse.storage.prepare({
    context: contexts,
    pieceSizes: [BigInt(car.length)],
  })
  if (prepared.transaction != null) {
    const amount = formatUnits(prepared.transaction.depositAmount, 18)
    log(`Depositing ${amount} USDFC${prepared.transaction.includesApproval ? ' and approving the storage service' : ''}`)
    const { hash } = await prepared.transaction.execute()
    log(`Funding transaction: ${hash}`)
  }

  const result = await synapse.storage.upload(car, {
    contexts,
    pieceMetadata: { ipfsRootCID: rootCid },
    callbacks: {
      onStored: (providerId) => log(`Stored on provider ${providerId}`),
      onPiecesAdded: (tx, providerId) => log(`Provider ${providerId} add-pieces transaction: ${tx}`),
      onPiecesConfirmed: (dataSetId, providerId) => log(`Provider ${providerId} confirmed in data set ${dataSetId}`),
      onCopyFailed: (providerId, _piece, error) => log(`Provider ${providerId} copy failed: ${error.message}`),
    },
  })

  if (result.copies.length === 0) throw new Error('Upload failed on every provider')

  return {
    pieceCid: result.pieceCid.toString(),
    uploaded: true,
    copies: result.copies.map((copy) => ({
      providerId: copy.providerId.toString(),
      dataSetId: copy.dataSetId.toString(),
      pieceId: copy.pieceId.toString(),
      origin: new URL(copy.retrievalUrl).origin,
    })),
    failed: result.failedAttempts.map((attempt) => ({
      providerId: attempt.providerId.toString(),
      error: attempt.error,
    })),
  }
}

export async function verifyRetrieval({ rootCid, copies, timeoutMs, log }) {
  const deadline = Date.now() + timeoutMs
  const pending = new Map(copies.map((copy) => [copy.providerId, `${copy.origin}/ipfs/${rootCid}/`]))
  const served = []

  while (pending.size > 0) {
    for (const [providerId, url] of pending) {
      if (await serves(url)) {
        log(`Provider ${providerId} serves ${url}`)
        served.push(providerId)
        pending.delete(providerId)
      }
    }
    if (pending.size === 0 || Date.now() > deadline) break
    await new Promise((done) => setTimeout(done, 15_000))
  }

  for (const [providerId, url] of pending) log(`Provider ${providerId} does not serve ${url}`)
  if (served.length === 0) throw new Error(`No provider serves ${rootCid} after ${timeoutMs / 1000}s`)
  return served
}
