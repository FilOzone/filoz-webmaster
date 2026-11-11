import { CID } from 'multiformats/cid'
import { createPublicClient, createWalletClient, http, parseAbi, toHex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { namehash, normalize } from 'viem/ens'

const REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
const REGISTRY_ABI = parseAbi(['function resolver(bytes32 node) view returns (address)'])
const RESOLVER_ABI = parseAbi([
  'function contenthash(bytes32 node) view returns (bytes)',
  'function setContenthash(bytes32 node, bytes hash)',
])
const ZERO = '0x0000000000000000000000000000000000000000'

export function encodeContenthash(cid) {
  const bytes = CID.parse(cid).toV1().bytes
  const out = new Uint8Array(bytes.length + 2)
  out[0] = 0xe3
  out[1] = 0x01
  out.set(bytes, 2)
  return toHex(out)
}

export function decodeContenthash(hex) {
  if (hex == null || hex === '0x') return null
  const bytes = hexToBytes(hex)
  if (bytes[0] !== 0xe3 || bytes[1] !== 0x01) return null
  return CID.decode(bytes.subarray(2)).toString()
}

async function locate(client, name) {
  const node = namehash(normalize(name))
  const resolver = await client.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'resolver',
    args: [node],
  })
  if (resolver === ZERO) throw new Error(`${name} has no resolver set`)
  return { node, resolver }
}

export async function readContenthash(name, rpcUrl) {
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
  const { node, resolver } = await locate(client, name)
  const hex = await client.readContract({
    address: resolver,
    abi: RESOLVER_ABI,
    functionName: 'contenthash',
    args: [node],
  })
  return decodeContenthash(hex)
}

export async function writeContenthash(name, cid, privateKey, rpcUrl) {
  const account = privateKeyToAccount(privateKey)
  const transport = http(rpcUrl)
  const client = createPublicClient({ chain: mainnet, transport })
  const wallet = createWalletClient({ account, chain: mainnet, transport })
  const { node, resolver } = await locate(client, name)

  const { request } = await client.simulateContract({
    account,
    address: resolver,
    abi: RESOLVER_ABI,
    functionName: 'setContenthash',
    args: [node, encodeContenthash(cid)],
  })
  const hash = await wallet.writeContract(request)
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 300_000 })
  if (receipt.status !== 'success') throw new Error(`ENS update reverted: ${hash}`)

  const now = await readContenthash(name, rpcUrl)
  if (now !== CID.parse(cid).toV1().toString()) {
    throw new Error(`ENS update confirmed but ${name} resolves to ${now}`)
  }
  return hash
}
