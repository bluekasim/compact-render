export interface CompactOptions {
  /** Structural gate: minimum rows for TOON to be considered. Default 3. */
  minItems?: number
  /** Structural gate: minimum keys per row for TOON. Default 2. */
  minKeys?: number
  /** Exact mode: token counter (e.g. gpt-tokenizer's o200k countTokens). Overrides the structural gate. */
  countTokens?: (text: string) => number
}

export interface CompactResult {
  format: 'json' | 'toon'
  text: string
}

export declare const DEFAULTS: { readonly minItems: 3; readonly minKeys: 2 }

/** Decide the smaller encoding (JSON or TOON) for one tool-output value. Fail-closed to JSON. */
export declare function compact(value: unknown, options?: CompactOptions): CompactResult

/** The decision as a single `[{ type: 'text', text }]` content block for agent/MCP tool protocols. */
export declare function renderToolOutput(value: unknown, options?: CompactOptions): { type: 'text'; text: string }[]
