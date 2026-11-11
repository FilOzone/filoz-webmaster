import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { globSource, unixfs } from '@helia/unixfs'
import { CarWriter } from '@ipld/car'
import { BaseBlockstore } from 'blockstore-core'

async function collect(iterable) {
  const chunks = []
  let length = 0
  for await (const chunk of iterable) {
    chunks.push(chunk)
    length += chunk.length
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

class RecordingBlockstore extends BaseBlockstore {
  blocks = new Map()

  async put(cid, value) {
    const bytes = value instanceof Uint8Array ? value : await collect(value)
    this.blocks.set(cid.toString(), { cid, bytes })
    return cid
  }

  async *get(cid) {
    const block = this.blocks.get(cid.toString())
    if (block == null) throw new Error(`Block not found: ${cid}`)
    yield block.bytes
  }

  async has(cid) {
    return this.blocks.has(cid.toString())
  }
}

export async function packDirectory(dir) {
  const root = resolve(dir)
  const info = await stat(root).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`Not a directory: ${root}`)

  const blockstore = new RecordingBlockstore()
  const fs = unixfs({ blockstore })

  let files = 0
  let rootCid
  for await (const entry of fs.addAll(globSource(root, '**/*'), { wrapWithDirectory: true })) {
    if (entry.path !== '' && entry.unixfs?.type !== 'directory') files++
    rootCid = entry.cid
  }
  if (rootCid == null || files === 0) throw new Error(`Directory is empty: ${root}`)

  const { writer, out } = CarWriter.create([rootCid])
  const bytes = collect(out)
  for (const block of blockstore.blocks.values()) {
    await writer.put(block)
  }
  await writer.close()

  return { rootCid: rootCid.toString(), car: await bytes, files }
}
