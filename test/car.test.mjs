import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { unixfs } from '@helia/unixfs'
import { CarReader } from '@ipld/car'
import { CID } from 'multiformats/cid'
import { packDirectory } from '../src/car.mjs'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'webmaster-'))
  await mkdir(join(dir, 'data'))
  await writeFile(join(dir, 'index.html'), '<h1>hello</h1>')
  await writeFile(join(dir, 'data', 'records.jsonl'), '{"a":1}\n')
  return dir
}

test('packs a folder into a CAR whose single root is the folder CID', async () => {
  const { rootCid, car, files } = await packDirectory(await fixture())
  const reader = await CarReader.fromBytes(car)
  const roots = await reader.getRoots()
  assert.equal(files, 2)
  assert.equal(roots.length, 1)
  assert.equal(roots[0].toString(), rootCid)
  assert.ok(await reader.has(roots[0]))
  assert.match(rootCid, /^bafybei/)
})

test('every file can be read back out of the CAR by path', async () => {
  const { rootCid, car } = await packDirectory(await fixture())
  const reader = await CarReader.fromBytes(car)
  const blockstore = {
    async *get(cid) {
      const block = await reader.get(cid)
      if (block == null) throw new Error(`missing ${cid}`)
      yield block.bytes
    },
    has: (cid) => reader.has(cid),
  }
  const fs = unixfs({ blockstore })
  const read = async (path) => {
    const chunks = []
    for await (const chunk of fs.cat(CID.parse(rootCid), { path })) chunks.push(chunk)
    return Buffer.concat(chunks).toString()
  }
  assert.equal(await read('index.html'), '<h1>hello</h1>')
  assert.equal(await read('data/records.jsonl'), '{"a":1}\n')
})

test('gives the same CID for the same content', async () => {
  const a = await packDirectory(await fixture())
  const b = await packDirectory(await fixture())
  assert.equal(a.rootCid, b.rootCid)
})

test('rejects an empty folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'webmaster-'))
  await assert.rejects(packDirectory(dir), /empty/)
})
