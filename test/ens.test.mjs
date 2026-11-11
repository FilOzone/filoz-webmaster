import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeContenthash, encodeContenthash } from '../src/ens.mjs'

const CID = 'bafybeiejj36bzjhxsyskh7euss45u2p45ifcheqzw2i5fbimybd4kmu3jq'
const HEX = '0xe30101701220894efc1ca4f79624a3fc9494b9da69fcea0a239219b691d2850cc047c5329b4c'

test('encodes a CID as an EIP-1577 IPFS contenthash', () => {
  assert.equal(encodeContenthash(CID), HEX)
})

test('decodes an IPFS contenthash back to its CID', () => {
  assert.equal(decodeContenthash(HEX), CID)
})

test('returns null for an empty or non-IPFS contenthash', () => {
  assert.equal(decodeContenthash('0x'), null)
  assert.equal(decodeContenthash('0xe5010172'), null)
})
