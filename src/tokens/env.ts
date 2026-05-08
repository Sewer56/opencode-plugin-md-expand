import type { ProtectedRange, SyncExpandResult, ReplacementRange } from "../types"
import type { ResolvedMdExpandOptions } from "../options"
import { ENV_PREFIX, TOKEN_END, EMPTY_EXPANSION_MARKER } from "../token-syntax"
import { collectFileArgRanges } from "../template/file-parser"
import { advanceRangeIndex, isInRange, mergeRanges } from "../ranges"
import { createDebugLogger } from "../debug"

function remapProtectedRanges(
  ranges: ProtectedRange[],
  replacements: ReplacementRange[],
): ProtectedRange[] {
  if (!ranges.length || !replacements.length) return ranges

  const out: ProtectedRange[] = []
  let replacementIndex = 0
  let delta = 0
  for (const range of ranges) {
    while (replacementIndex < replacements.length && replacements[replacementIndex].end <= range.start) {
      const replacement = replacements[replacementIndex]
      delta += replacement.length - (replacement.end - replacement.start)
      replacementIndex++
    }
    out.push({ start: range.start + delta, end: range.end + delta })
  }
  return out
}

/**
 * Expand `{{env:VAR}}` tokens with manual scanning.
 */
export function expandEnvTokens(
  text: string,
  protectedRanges: ProtectedRange[],
  options?: ResolvedMdExpandOptions,
): SyncExpandResult {
  const logger = options ? createDebugLogger(options) : undefined
  const fileArgRanges = collectFileArgRanges(text, protectedRanges)
  const skipRanges = mergeRanges(protectedRanges, fileArgRanges)
  let skipIndex = 0
  let out = ""
  let cursor = 0
  let searchFrom = 0
  let changed = false
  const replacements: ReplacementRange[] | undefined = protectedRanges.length ? [] : undefined

  while (true) {
    const start = text.indexOf(ENV_PREFIX, searchFrom)
    if (start === -1) break

    skipIndex = advanceRangeIndex(skipRanges, skipIndex, start)
    if (isInRange(skipRanges, skipIndex, start)) {
      searchFrom = skipRanges[skipIndex].end
      continue
    }

    const valueStart = start + ENV_PREFIX.length
    const end = text.indexOf(TOKEN_END, valueStart)
    if (end === -1) break

    if (end === valueStart) {
      searchFrom = valueStart
      continue
    }

    const varName = text.slice(valueStart, end)
    const rawValue = process.env[varName] ?? ""
    const value = rawValue.length ? rawValue : EMPTY_EXPANSION_MARKER
    logger?.log(`env: ${varName} → ${rawValue ? "<set>" : "<unset>"}`)

    out += text.slice(cursor, start) + value
    replacements?.push({ start, end: end + TOKEN_END.length, length: value.length })
    cursor = end + TOKEN_END.length
    searchFrom = cursor
    changed = true
  }

  if (!changed) return { text, protectedRanges }
  return {
    text: out + text.slice(cursor),
    protectedRanges: replacements
      ? remapProtectedRanges(protectedRanges, replacements)
      : protectedRanges,
  }
}
