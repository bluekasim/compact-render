# compact-render

[![npm version](https://img.shields.io/npm/v/compact-render.svg)](https://www.npmjs.com/package/compact-render)
[![license](https://img.shields.io/npm/l/compact-render.svg)](./LICENSE)
[![tests](https://github.com/bluekasim/compact-render/actions/workflows/publish.yml/badge.svg)](https://github.com/bluekasim/compact-render/actions/workflows/publish.yml)

Fail-closed compact renderer for structured LLM tool outputs.

Tool results are usually serialized as JSON, which repeats every object key on every row of a list.
[TOON](https://github.com/toon-format/toon) (Token-Oriented Object Notation) collapses those
repeated keys into a one-time column header, so arrays of uniform objects get smaller. But TOON is
**not** a universal win — and this library exists because of that.

## The honest finding

Measured against the **o200k_base** tokenizer (GPT-4o), on eight real agent-tool output shapes
(field names taken from a production file/grep/batch tool), TOON's savings depend entirely on shape:

| Output shape | N | JSON tok | TOON tok | Δ% |
|---|---|---|---|---|
| flat scalar array (glob `paths`) | 64 | 820 | 826 | **−0.7% (regresses)** |
| single-key table (grep `files_with_matches`) | 50 | 753 | 711 | +5.6% |
| `{path,line,text}` (grep content) | 40 | 1533 | 1344 | +12.3% |
| `{path,line,text}` (inspect) | 100 | 4053 | 3564 | +12.1% |
| `{path,count}` (grep count) | 50 | 953 | 812 | +14.8% |
| `{path,bytes,modified}` (glob details) | 64 | 1717 | 1409 | +17.9% |
| 5-field table (replace dry-run) | 20 | 1178 | 952 | +19.2% |
| uniform object page (result paging) | 64 | 1773 | 1316 | **+25.8%** |
| **total** | | **12780** | **10934** | **+14.4%** |

- **Wins are concentrated** in multi-field object tables (12–26%).
- **Flat arrays and single-key tables do not meaningfully win** — flat arrays actually regress,
  because o200k tokenizes JSON punctuation efficiently and there are no repeated keys to collapse.
- **Break-even is ~3 rows**: at N=1 TOON's per-table header makes it larger; N≥3 is where it pays.

So a blanket "switch everything to TOON" is wrong. `compact-render` picks the smaller encoding
**per result** and is **fail-closed**: anything outside the winning regime returns the exact JSON
you would have emitted anyway.

## Install

```bash
npm install compact-render
```

## Usage

```js
import { compact, renderToolOutput } from 'compact-render'

// Decide the smaller encoding for one tool result.
const { format, text } = compact(value)
// format: 'json' | 'toon'

// Or drop it straight into an agent/MCP tool's output renderer:
const content = renderToolOutput(value) // [{ type: 'text', text }]
```

### Decision modes

**Default — dependency-free structural gate (recommended).**
No tokenizer is shipped. TOON is used only when `value.items` is a uniform object table with
`>= minItems` (3) rows and `>= minKeys` (2) identical keys. This gate reproduces every decision in
the table above.

```js
renderToolOutput(value)                       // structural gate
renderToolOutput(value, { minItems: 5 })      // tune the thresholds
```

**Exact — supply your own token counter.**
For o200k-exact decisions without this library depending on a multi-megabyte BPE vocabulary, pass a
`countTokens` function. The structural gate is bypassed and the smaller token count wins:

```js
import { countTokens } from 'gpt-tokenizer' // o200k_base
renderToolOutput(value, { countTokens })
```

## API

| Export | Signature | Returns |
|---|---|---|
| `compact` | `(value, options?) => { format, text }` | the chosen encoding |
| `renderToolOutput` | `(value, options?) => [{ type:'text', text }]` | agent/MCP content block |
| `DEFAULTS` | `{ minItems: 3, minKeys: 2 }` | calibrated thresholds |

Options: `minItems` (3), `minKeys` (2), `countTokens` (exact mode).

Fail-closed: any TOON encode error, a non-object `value`, or a degenerate `JSON.stringify` result
all return the exact prior JSON. Behavior outside the winning regime is unchanged.

## Why not just ship a tokenizer?

This library is meant to sit inside tool runtimes that value leanness. The default path is
dependency-free (only the small, pure-JS TOON encoder). If you want exact per-result decisions, the
`countTokens` hook lets you bring `gpt-tokenizer` (o200k) yourself — the library never forces a
multi-megabyte vocabulary on you.

## Measurement notes

- Token counts are **o200k_base**, cross-verified with two independent implementations
  (Node `gpt-tokenizer` and Python `tiktoken`); both agree token-for-token.
- These are estimates of what the model reads, not provider bills.
- Thresholds are calibrated to the shapes above; re-measure if your output shapes differ.

## Publishing

Publishing is automated by [`.github/workflows/publish.yml`](./.github/workflows/publish.yml):

1. Bump `version` in `package.json` and commit.
2. Cut a GitHub Release whose tag matches that version (e.g. `v0.2.0` for `0.2.0`). The workflow
   verifies the tag matches `package.json` before doing anything else.
3. On release, CI runs `npm ci` + tests, then `npm publish --provenance --access public` to
   **registry.npmjs.org** (the global registry, regardless of any local mirror config).

Prereleases are skipped. You can also run it manually from the Actions tab (`workflow_dispatch`),
which publishes whatever version is currently in `package.json`.

One-time setup: add a repository secret **`NPM_TOKEN`** — an npm token with publish rights on
npmjs.org (Settings → Secrets and variables → Actions → New repository secret). Without it the
publish step fails. The workflow always targets npmjs.org even if your machine defaults to a mirror.

## License

MIT. Depends on [`@toon-format/toon`](https://github.com/toon-format/toon) (MIT).
