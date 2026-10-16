/**
 * compact-render — fail-closed compact renderer for structured LLM tool outputs.
 *
 * Tool results are usually serialized as JSON, which repeats every object key on every row of a
 * list. TOON (Token-Oriented Object Notation) collapses those repeated keys into a one-time column
 * header, so arrays of uniform objects get smaller. But TOON is NOT a universal win: under the
 * o200k_base tokenizer, flat scalar arrays (e.g. glob path lists) actually get *larger*, single-key
 * object tables barely break even, and tiny lists lose to TOON's per-table header overhead.
 *
 * This library picks the smaller encoding per result and is fail-closed: anything outside the
 * winning regime — or any encode error — returns the exact JSON you would have emitted anyway.
 *
 * Two decision modes:
 *   - default (no `countTokens`): a dependency-free structural gate, calibrated to o200k_base.
 *     TOON is used only for a uniform object table with >= `minItems` rows and >= `minKeys` keys.
 *   - exact (`countTokens` supplied): pick whichever encoding tokenizes to fewer tokens. Pass e.g.
 *     gpt-tokenizer's `countTokens` for o200k-exact decisions without this library shipping a
 *     multi-megabyte BPE vocabulary.
 */
import { encode as toonEncode } from '@toon-format/toon'

export const DEFAULTS = Object.freeze({ minItems: 3, minKeys: 2 })

/**
 * Decide the smaller encoding for one tool-output value.
 *
 * @param {unknown} value - the structured tool result (typically an object with an `items` array).
 * @param {object} [options]
 * @param {number} [options.minItems=3] - structural gate: minimum rows for TOON to be considered.
 * @param {number} [options.minKeys=2] - structural gate: minimum keys per row for TOON.
 * @param {(text: string) => number} [options.countTokens] - exact mode: token counter (e.g. o200k).
 * @returns {{ format: 'json' | 'toon', text: string }}
 */
export function compact(value, options = {}) {
  const {
    minItems = DEFAULTS.minItems,
    minKeys = DEFAULTS.minKeys,
    countTokens,
  } = options

  const json = JSON.stringify(value)
  // A tool result is always an object; guard the degenerate case so we never emit `undefined`.
  if (typeof json !== 'string') return { format: 'json', text: 'null' }

  let toon
  try {
    toon = toonEncode(value)
  } catch {
    return { format: 'json', text: json } // TOON unavailable/unencodable -> exact prior JSON
  }

  let useToon
  if (typeof countTokens === 'function') {
    try {
      useToon = countTokens(toon) < countTokens(json)
    } catch {
      useToon = false
    }
  } else {
    useToon = toonBeatsJson(value, json, toon, minItems, minKeys)
  }

  return useToon ? { format: 'toon', text: toon } : { format: 'json', text: json }
}

/**
 * Convenience for agent / MCP tool protocols: the decision as a single text content block, matching
 * the `[{ type: 'text', text }]` shape those protocols expect from an output renderer.
 *
 * @param {unknown} value
 * @param {object} [options] - see {@link compact}.
 * @returns {{ type: 'text', text: string }[]}
 */
export function renderToolOutput(value, options) {
  return [{ type: 'text', text: compact(value, options).text }]
}

/**
 * Structural gate (dependency-free path). Returns true only for the shape where TOON reliably costs
 * fewer o200k tokens than JSON: `value.items` is an array of >= `minItems` objects that all carry
 * the same >= `minKeys` keys. Flat arrays, single-key tables, ragged keys and small lists keep JSON.
 * The char-length comparison is a backstop; the structural gate alone reproduces every measured
 * o200k decision (see README).
 */
function toonBeatsJson(value, json, toon, minItems, minKeys) {
  const items = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value.items
    : undefined
  if (!Array.isArray(items) || items.length < minItems) return false

  let keys = null
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false
    const itemKeys = Object.keys(item)
    if (keys === null) {
      keys = itemKeys
      if (keys.length < minKeys) return false
    } else if (itemKeys.length !== keys.length || itemKeys.some((key, index) => key !== keys[index])) {
      return false // ragged keys: TOON would not use its compact columnar form
    }
  }

  return toon.length < json.length
}
