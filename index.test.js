import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encode, decode } from '@toon-format/toon'
import { compact, renderToolOutput, DEFAULTS } from './index.js'

const env = (items) => ({
  status: 'completed', phase: 'verify', changed: 0, matched: items.length, skipped: 0, failed: 0,
  complete: true, truncated: false, omitted: 0, total: items.length, nextOffset: items.length, items,
})
const table = (n, keys) => Array.from({ length: n }, (_, i) => Object.fromEntries(keys.map((k, j) => [k, j === 0 ? `v${i}` : i])))

test('DEFAULTS are the o200k-calibrated thresholds', () => {
  assert.deepEqual({ ...DEFAULTS }, { minItems: 3, minKeys: 2 })
})

test('TOON is chosen only for uniform multi-field object tables of sufficient size', () => {
  assert.equal(compact(env(table(5, ['path', 'count']))).format, 'toon', 'grep-count shape')
  assert.equal(compact(env(table(5, ['path', 'size', 'kind', 'depth']))).format, 'toon', 'result-page shape')
})

test('fail-closed to JSON outside the winning regime', () => {
  assert.equal(compact(env(['a/b.js', 'a/c.js', 'a/d.js'])).format, 'json', 'flat scalar array (glob paths)')
  assert.equal(compact(env(table(5, ['path']))).format, 'json', 'single-key table (grep files_with_matches)')
  assert.equal(compact(env(table(2, ['path', 'count']))).format, 'json', 'list below minItems')
  assert.equal(compact(env([{ path: 'a', count: 1 }, { path: 'b' }])).format, 'json', 'ragged keys')
  assert.equal(compact({ status: 'error', error: { code: 'X', phase: 'preflight', retryable: false, effectState: 'none', message: 'boom' } }).format, 'json', 'error envelope has no items')
  assert.equal(compact({ items: [1, 2, 3, 4] }).format, 'json', 'scalar items array')
  assert.equal(compact(null).format, 'json', 'null value')
  assert.equal(compact(42).format, 'json', 'scalar value')
})

test('the JSON branch is byte-identical to JSON.stringify', () => {
  const value = env(['a/b.js', 'a/c.js', 'a/d.js'])
  assert.equal(compact(value).text, JSON.stringify(value))
})

test('the TOON branch round-trips losslessly to the original value', () => {
  const value = env(table(6, ['path', 'count']))
  const { format, text } = compact(value)
  assert.equal(format, 'toon')
  assert.deepEqual(decode(text), value)
})

test('exact mode delegates the decision to countTokens, overriding the structural gate', () => {
  const value = env(['a/b.js', 'a/c.js', 'a/d.js']) // structural gate keeps this JSON
  const json = JSON.stringify(value)
  const toon = encode(value)
  const toonCheaper = new Map([[json, 100], [toon, 5]])
  const jsonCheaper = new Map([[json, 5], [toon, 100]])
  assert.equal(compact(value, { countTokens: (s) => toonCheaper.get(s) }).format, 'toon')
  assert.equal(compact(value, { countTokens: (s) => jsonCheaper.get(s) }).format, 'json')
})

test('threshold options are honoured', () => {
  assert.equal(compact(env(table(2, ['path', 'count'])), { minItems: 2 }).format, 'toon', 'lowering minItems admits N=2')
  assert.equal(compact(env(table(5, ['path'])), { minKeys: 1 }).format, 'toon', 'lowering minKeys admits single-key')
})

test('renderToolOutput returns a single text content block', () => {
  const value = env(table(5, ['path', 'count']))
  const block = renderToolOutput(value)
  assert.equal(block.length, 1)
  assert.equal(block[0].type, 'text')
  assert.equal(block[0].text, compact(value).text)
})
