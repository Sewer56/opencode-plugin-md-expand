import { createDebugLogger } from "../debug";
import type { ResolvedMdExpandOptions } from "../options";
import type { ProtectedRange, SyncExpandResult } from "../ranges";
import { ARG_PREFIX, TOKEN_END, TOKEN_START, EMPTY_EXPANSION_MARKER } from "../token-syntax";

/**
 * Expand `{{arg:key}}` tokens with manual scanning.
 */
export function expandArgTokens(
  text: string,
  args: Map<string, string>,
  options?: ResolvedMdExpandOptions,
): SyncExpandResult {
  const logger = options?.debug ? createDebugLogger(options) : undefined;
  let out = "";
  let cursor = 0;
  let searchFrom = 0;
  let changed = false;
  const protectedRanges: ProtectedRange[] = [];

  while (true) {
    const start = text.indexOf(ARG_PREFIX, searchFrom);
    if (start === -1) break;

    const valueStart = start + ARG_PREFIX.length;
    const end = text.indexOf(TOKEN_END, valueStart);
    if (end === -1) break;

    const key = text.slice(valueStart, end);
    const found = args.has(key);
    const rawValue = found ? args.get(key)! : "";
    const value = rawValue.length ? rawValue : EMPTY_EXPANSION_MARKER;
    logger?.log(`arg: ${key} → ${found ? value : "<undefined>"}`);

    out += text.slice(cursor, start);
    const outStart = out.length;
    out += value;

    if (value.indexOf(TOKEN_START) !== -1 || value.indexOf(TOKEN_END) !== -1) {
      protectedRanges.push({ start: outStart, end: outStart + value.length });
    }

    cursor = end + TOKEN_END.length;
    searchFrom = cursor;
    changed = true;
  }

  return changed
    ? { text: out + text.slice(cursor), protectedRanges }
    : { text, protectedRanges: [] };
}
