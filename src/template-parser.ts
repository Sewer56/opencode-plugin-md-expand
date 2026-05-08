import type {
  FileTemplateSpec,
  TemplateValue,
  ProtectedRange,
  IfCondition,
  InlineIfTemplateSpec,
  InlineEndifTemplateSpec,
  InlineElseTemplateSpec,
  InlineIfCloseResult,
} from "./types.js"
import {
  TOKEN_START,
  TOKEN_END,
  FILE_TEMPLATE_START,
  FILE_TEMPLATE_END,
  FILE_ATTR,
  IF_ATTR,
  ENDIF_ATTR,
  ENV_CONDITION_PREFIX,
  ENV_PREFIX,
  ARG_PREFIX,
  EMPTY_RANGES,
  EMPTY_EXPANSION_MARKER,
} from "./constants.js"
import { advanceRangeIndex, isInRange } from "./ranges.js"

/** Fast check for `{{ file=... }}`. Requires `file` first by style rule. Rejects `{{arg:}}` and `{{env:}}`. */
export function startsFileTemplate(text: string, start: number): boolean {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false
  let i = start + FILE_TEMPLATE_START.length
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++
  if (!text.startsWith(FILE_ATTR, i)) return false
  i += FILE_ATTR.length
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++
  return text.charCodeAt(i) === 61 // =
}

/** Fast check for `{{ if=... }}`. Requires `if` first by style rule. */
export function startsInlineIfTemplate(text: string, start: number): boolean {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false
  let i = start + FILE_TEMPLATE_START.length
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++
  if (!text.startsWith(IF_ATTR, i)) return false
  i += IF_ATTR.length
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++
  return text.charCodeAt(i) === 61 // =
}

/** Fast transform gate. Exact file expansion still requires a closing `}}` later. */
export function hasExpandableToken(text: string): boolean {
  let start = text.indexOf(TOKEN_START)
  while (start !== -1) {
    // All expandable tokens start with `{{`: file templates, inline ifs,
    // {{arg:...}}, and {{env:...}}.
    if (text.charCodeAt(start + 1) === 123) { // {
      if (startsFileTemplate(text, start) || startsInlineIfTemplate(text, start)) return true
      if (text.startsWith(ARG_PREFIX, start)) return true
      if (text.startsWith(ENV_PREFIX, start)) return true
    }
    start = text.indexOf(TOKEN_START, start + 1)
  }
  return false
}

/**
 * Parse one `{{ file="..." ... }}` template.
 *
 * Grammar stays intentionally small and scanner-only for prompt hot path:
 * - `file` must be the first attribute
 * - attributes are `key=value`; whitespace around `=` is allowed
 * - values are unquoted until whitespace/`}}`, or double-quoted with spaces
 * - common escapes decode in values: `\n`, `\r`, `\t`, `\b`, `\f`, `\v`, `\"`, `\\`
 * - duplicate arg keys use last value; duplicate `file` overwrites path
 * - `if=arg` checks non-empty; `if=arg==value` checks exact equality
 */
export function parseFileTemplate(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
  collectArgRanges = false,
): FileTemplateSpec | undefined {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined

  let i = start + FILE_TEMPLATE_START.length
  i = skipTemplateSpace(text, i)

  const firstKeyStart = i
  i = scanTemplateKey(text, i)
  if (i === firstKeyStart || text.slice(firstKeyStart, i) !== FILE_ATTR) return undefined

  i = skipTemplateSpace(text, i)
  if (text.charCodeAt(i) !== 61) return undefined // =
  i = skipTemplateSpace(text, i + 1)

  const fileValue = readTemplateValue(text, i, protectedRanges)
  if (!fileValue) return undefined
  let rawPath = fileValue.value
  i = fileValue.next

  let args: Map<string, string> | undefined
  let condition: IfCondition | undefined
  let argValueRanges: ProtectedRange[] | undefined

  while (i < text.length) {
    i = skipTemplateSpace(text, i)
    if (text.startsWith(FILE_TEMPLATE_END, i)) {
      return {
        rawPath,
        args: args ?? new Map(),
        condition,
        end: i + FILE_TEMPLATE_END.length - 1,
        argValueRanges,
      }
    }

    const keyStart = i
    i = scanTemplateKey(text, i)
    if (i === keyStart) return undefined
    const key = text.slice(keyStart, i)

    i = skipTemplateSpace(text, i)
    if (text.charCodeAt(i) !== 61) return undefined // =
    i = skipTemplateSpace(text, i + 1)

    const value = readTemplateValue(text, i, protectedRanges)
    if (!value) return undefined
    i = value.next

    if (!isValidArgKey(key)) {
      continue
    }

    if (key === FILE_ATTR) {
      rawPath = value.value
      continue
    }

    if (key === IF_ATTR) {
      condition = parseIfCondition(value.value)
      if (!condition) {
        return undefined
      }
      continue
    }

    if (!args) args = new Map()
    args.set(key, value.value)

    if (collectArgRanges) {
      if (!argValueRanges) argValueRanges = []
      argValueRanges.push({ start: value.valueStart, end: value.valueEnd })
    }
  }

  return undefined
}

function scanTemplateKey(text: string, i: number): number {
  if (i >= text.length || !isArgKeyStart(text.charCodeAt(i))) return i
  i++
  while (i < text.length && isArgKeyChar(text.charCodeAt(i))) i++
  return i
}

function readTemplateValue(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
): TemplateValue | undefined {
  if (start > text.length) return undefined
  if (text.charCodeAt(start) === 34) return readQuotedTemplateValue(text, start, protectedRanges) // "
  return readUnquotedTemplateValue(text, start, protectedRanges)
}

function readQuotedTemplateValue(
  text: string,
  quoteStart: number,
  protectedRanges: ProtectedRange[],
): TemplateValue | undefined {
  let i = quoteStart + 1
  let chunkStart = i
  let value: string | undefined
  let protectedIndex = 0

  while (i < text.length) {
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, i)
    if (isInRange(protectedRanges, protectedIndex, i)) {
      i = protectedRanges[protectedIndex].end
      continue
    }

    const code = text.charCodeAt(i)
    if (code === 92) { // \
      if (value === undefined) value = ""
      value += text.slice(chunkStart, i) + decodeTemplateEscape(text.charCodeAt(i + 1))
      i += i + 1 < text.length ? 2 : 1
      chunkStart = i
      continue
    }
    if (code === 34) { // "
      return {
        value: value === undefined ? text.slice(quoteStart + 1, i) : value + text.slice(chunkStart, i),
        valueStart: quoteStart + 1,
        valueEnd: i,
        next: i + 1,
      }
    }
    i++
  }

  return undefined
}

function readUnquotedTemplateValue(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
): TemplateValue {
  let i = start
  let protectedIndex = 0
  while (i < text.length) {
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, i)
    if (isInRange(protectedRanges, protectedIndex, i)) {
      i = protectedRanges[protectedIndex].end
      continue
    }

    const code = text.charCodeAt(i)
    if (isTemplateSpace(code) || text.startsWith(FILE_TEMPLATE_END, i)) break
    i++
  }

  const raw = text.slice(start, i)
  return {
    value: raw.indexOf("\\") === -1 ? raw : decodeTemplateEscapes(raw),
    valueStart: start,
    valueEnd: i,
    next: i,
  }
}

/**
 * Parse the small `if` condition grammar shared by file imports and inline blocks.
 *
 * Supported forms are `arg`, `arg==value`, `env:NAME`, and `env:NAME==value`.
 * There is no expression parser, boolean algebra, negation, or empty-string
 * equality check; invalid input returns `undefined` so the caller can leave the
 * template literal intact for validation.
 */
export function parseIfCondition(raw: string): IfCondition | undefined {
  if (raw.length === 0) return undefined

  const equality = raw.indexOf("==")
  const key = equality === -1 ? raw : raw.slice(0, equality)
  const expected = equality === -1 ? undefined : raw.slice(equality + 2)
  if (expected !== undefined && expected.length === 0) return undefined

  if (key.startsWith(ENV_CONDITION_PREFIX)) {
    const envKey = key.slice(ENV_CONDITION_PREFIX.length)
    return isValidEnvKey(envKey) ? { source: "env", key: envKey, expected } : undefined
  }

  return isValidArgKey(key) ? { source: "arg", key, expected } : undefined
}

/**
 * Find non-file arg value spans in `{{ file="..." key=value }}` templates.
 *
 * Example: in `{{ file="./tmpl" x="{{env:FOO}}" }}`, this returns the span
 * covering `{{env:FOO}}`. The env pass ignores it at caller level; later,
 * `parseFileTemplate` passes it as literal `x` to `tmpl`. The `file` value is
 * not protected so `{{arg:topic}}` and `{{env:PATH_PART}}` can compose paths.
 */
export function collectFileArgRanges(text: string, protectedRanges: ProtectedRange[]): ProtectedRange[] {
  if (text.indexOf(FILE_TEMPLATE_START) === -1) return EMPTY_RANGES

  const ranges: ProtectedRange[] = []
  let searchFrom = 0
  let protectedIndex = 0

  while (true) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom)
    if (start === -1) break

    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start)
    if (isInRange(protectedRanges, protectedIndex, start)) {
      searchFrom = protectedRanges[protectedIndex].end
      continue
    }

    const parsed = parseFileTemplate(text, start, protectedRanges, true)
    if (!parsed) {
      searchFrom = start + FILE_TEMPLATE_START.length
      continue
    }

    if (parsed.argValueRanges) ranges.push(...parsed.argValueRanges)
    searchFrom = parsed.end + 1
  }

  return ranges.length ? ranges : EMPTY_RANGES
}

// ── Inline conditional parsers ─────────────────────────────────────────────────

/**
 * Parse an inline conditional opening marker: `{{ if=condition }}`.
 *
 * Accepted conditions are the same small grammar as file-template `if` attrs:
 * `arg`, `arg==value`, `env:NAME`, and `env:NAME==value`. Anything malformed
 * returns `undefined` and remains literal for validation.
 */
export function parseInlineIfTemplate(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
): InlineIfTemplateSpec | undefined {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined

  let i = start + FILE_TEMPLATE_START.length
  i = skipTemplateSpace(text, i)

  const keyStart = i
  i = scanTemplateKey(text, i)
  if (i === keyStart || text.slice(keyStart, i) !== IF_ATTR) return undefined

  i = skipTemplateSpace(text, i)
  if (text.charCodeAt(i) !== 61) return undefined // =
  i = skipTemplateSpace(text, i + 1)

  const value = readTemplateValue(text, i, protectedRanges)
  if (!value) return undefined
  const condition = parseIfCondition(value.value)
  if (!condition) return undefined
  i = skipTemplateSpace(text, value.next)

  if (!text.startsWith(FILE_TEMPLATE_END, i)) return undefined
  return { condition, end: i + FILE_TEMPLATE_END.length - 1 }
}

/**
 * Parse an inline conditional closing marker: `{{ endif }}`.
 *
 * Closing markers accept surrounding whitespace but no attributes. Non-matching
 * `{{ ... }}` text returns `undefined` so other template forms can coexist.
 */
export function parseInlineEndifTemplate(text: string, start: number): InlineEndifTemplateSpec | undefined {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined

  let i = start + FILE_TEMPLATE_START.length
  i = skipTemplateSpace(text, i)

  const keyStart = i
  i = scanTemplateKey(text, i)
  if (i === keyStart || text.slice(keyStart, i) !== ENDIF_ATTR) return undefined

  i = skipTemplateSpace(text, i)
  if (!text.startsWith(FILE_TEMPLATE_END, i)) return undefined
  return { start, end: i + FILE_TEMPLATE_END.length - 1 }
}

const ELSE_ATTR = "else"

/**
 * Parse an inline else marker: `{{ else }}`.
 *
 * Else markers accept surrounding whitespace but no attributes. Non-matching
 * `{{ ... }}` text returns `undefined` so other template forms can coexist.
 */
export function parseInlineElseTemplate(text: string, start: number): InlineElseTemplateSpec | undefined {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined

  let i = start + FILE_TEMPLATE_START.length
  i = skipTemplateSpace(text, i)

  const keyStart = i
  i = scanTemplateKey(text, i)
  if (i === keyStart || text.slice(keyStart, i) !== ELSE_ATTR) return undefined

  i = skipTemplateSpace(text, i)
  if (!text.startsWith(FILE_TEMPLATE_END, i)) return undefined
  return { start, end: i + FILE_TEMPLATE_END.length - 1 }
}

/**
 * Find the `{{ endif }}` marker that closes an opening inline `{{ if=... }}`,
 * and optionally the `{{ else }}` marker at the same nesting depth.
 *
 * Nested conditionals increment depth and must close before the outer block can
 * close. Invalid marker-looking text is ignored so unrelated `{{ ... }}` content
 * does not break parsing.
 */
export function findMatchingInlineEndif(
  text: string,
  searchStart: number,
  rangeEnd: number,
  protectedRanges: ProtectedRange[],
): InlineIfCloseResult | undefined {
  let depth = 1
  let searchFrom = searchStart
  let protectedIndex = advanceRangeIndex(protectedRanges, 0, searchStart)
  let elseMarker: InlineElseTemplateSpec | undefined

  while (searchFrom < rangeEnd) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom)
    if (start === -1 || start >= rangeEnd) return undefined

    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start)
    if (isInRange(protectedRanges, protectedIndex, start)) {
      searchFrom = protectedRanges[protectedIndex].end
      continue
    }

    const nested = parseInlineIfTemplate(text, start, protectedRanges)
    if (nested && nested.end + 1 <= rangeEnd) {
      depth++
      searchFrom = nested.end + 1
      continue
    }

    const elseParsed = parseInlineElseTemplate(text, start)
    if (elseParsed && elseParsed.end + 1 <= rangeEnd) {
      if (depth === 1 && !elseMarker) {
        elseMarker = elseParsed
      }
      searchFrom = elseParsed.end + 1
      continue
    }

    const closing = parseInlineEndifTemplate(text, start)
    if (closing && closing.end + 1 <= rangeEnd) {
      depth--
      if (depth === 0) return { endif: closing, elseMarker }
      searchFrom = closing.end + 1
      continue
    }

    searchFrom = start + FILE_TEMPLATE_START.length
  }

  return undefined
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeTemplateEscapes(text: string): string {
  let out = ""
  let chunkStart = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 92) continue // \
    out += text.slice(chunkStart, i) + decodeTemplateEscape(text.charCodeAt(i + 1))
    i += i + 1 < text.length ? 1 : 0
    chunkStart = i + 1
  }
  return out + text.slice(chunkStart)
}

function decodeTemplateEscape(code: number): string {
  if (Number.isNaN(code)) return "\\"
  switch (code) {
    case 34: return '"'
    case 92: return "\\"
    case 98: return "\b"
    case 102: return "\f"
    case 110: return "\n"
    case 114: return "\r"
    case 116: return "\t"
    case 118: return "\v"
    default: return String.fromCharCode(code)
  }
}

/** Template attrs may span lines; any common ASCII whitespace separates items. */
function isTemplateSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13
}

function skipTemplateSpace(text: string, i: number): number {
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++
  return i
}

/** Validate `[a-zA-Z_][a-zA-Z0-9_-]*` without regex allocation. */
function isValidArgKey(key: string): boolean {
  if (key.length === 0) return false
  if (!isArgKeyStart(key.charCodeAt(0))) return false
  for (let i = 1; i < key.length; i++) {
    if (!isArgKeyChar(key.charCodeAt(i))) return false
  }
  return true
}

/** Validate environment variable keys used by `if=env:NAME` conditions. */
function isValidEnvKey(key: string): boolean {
  if (key.length === 0) return false
  if (!isArgKeyStart(key.charCodeAt(0))) return false
  for (let i = 1; i < key.length; i++) {
    const code = key.charCodeAt(i)
    if (!isArgKeyStart(code) && (code < 48 || code > 57)) return false
  }
  return true
}

function isArgKeyStart(code: number): boolean {
  return code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isArgKeyChar(code: number): boolean {
  return isArgKeyStart(code) || code === 45 || (code >= 48 && code <= 57)
}
