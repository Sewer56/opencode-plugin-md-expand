import { createDebugLogger } from "../debug";
import type { ExpandContext } from "../expand";
import type { ResolvedMdExpandOptions } from "../options";
import { advanceRangeIndex, isInRange, type ProtectedRange } from "../ranges";
import { parseInlineIfTemplate, findMatchingInlineEndif } from "../template/conditional-parser";
import { shouldExpandForCondition } from "../template/conditions";
import { FILE_TEMPLATE_START, EMPTY_EXPANSION_MARKER, EMPTY_ARGS } from "../token-syntax";

/**
 * Expand inline conditional blocks (`{{ if=... }}...{{ else }}...{{ endif }}`)
 * in already arg/env-expanded text.
 *
 * Scans for `{{ if=... }}` / `{{ else }}` / `{{ endif }}` sequences and replaces
 * each block with the branch whose condition matches the current expansion
 * context. Blocks inside protected ranges are skipped.
 *
 * @param text - Source text containing inline conditional templates.
 * @param ctx - Expansion context providing args and diagnostics.
 * @param protectedRanges - Ranges that must not be rescanned (e.g. expanded arg values).
 * @param options - Resolved expansion options; used for debug logging.
 * @returns The text with inline conditional blocks resolved.
 *
 * @example
 * ```ts
 * // Input: "Hello {{ if=env:CI }}CI{{ else }}Local{{ endif }} world"
 * // With process.env.CI set:
 * // → "Hello CI world"
 * // Without process.env.CI:
 * // → "Hello Local world"
 * ```
 */
export function expandInlineConditionals(
  text: string,
  ctx: ExpandContext,
  protectedRanges: ProtectedRange[],
  options?: ResolvedMdExpandOptions,
): string {
  // Fast path: no template delimiters at all.
  if (text.indexOf(FILE_TEMPLATE_START) === -1) return text;
  return expandInlineConditionalsInRange(text, 0, text.length, ctx, protectedRanges, options);
}

/**
 * Recursively expand inline conditional blocks within a character range.
 *
 * Walks the text from `rangeStart` to `rangeEnd`, finding each `{{ if=... }}`
 * opening marker, its matching `{{ else }}` (if any) and `{{ endif }}`, then
 * replaces the whole block with the appropriate branch. Recursion handles
 * nested conditionals inside each branch.
 *
 * @param text - Full source text (shared across recursive calls).
 * @param rangeStart - Inclusive start offset of the scan window.
 * @param rangeEnd - Exclusive end offset of the scan window.
 * @param ctx - Expansion context providing args and diagnostics.
 * @param protectedRanges - Ranges that must not be rescanned.
 * @param options - Resolved expansion options; used for debug logging.
 * @returns The text segment for `rangeStart..rangeEnd` with conditionals resolved.
 */
function expandInlineConditionalsInRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  ctx: ExpandContext,
  protectedRanges: ProtectedRange[],
  options?: ResolvedMdExpandOptions,
): string {
  const logger = options?.debug ? createDebugLogger(options) : undefined;
  let out = "";
  let cursor = rangeStart;
  let searchFrom = rangeStart;
  // Track the current position in the sorted protected-ranges list.
  let protectedIndex = advanceRangeIndex(protectedRanges, 0, rangeStart);
  let changed = false;

  while (searchFrom < rangeEnd) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom);
    if (start === -1 || start >= rangeEnd) break;

    // Advance past any protected ranges we've overtaken.
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start);
    if (isInRange(protectedRanges, protectedIndex, start)) {
      // Skip the entire protected region to avoid expanding injected content.
      searchFrom = protectedRanges[protectedIndex].end;
      continue;
    }

    // Try to parse an `{{ if=... }}` opening marker at this position.
    const parsed = parseInlineIfTemplate(text, start, protectedRanges);
    if (!parsed || parsed.end + 1 > rangeEnd) {
      // Not a valid inline-if, or it crosses the range boundary; skip ahead.
      searchFrom = start + FILE_TEMPLATE_START.length;
      continue;
    }

    // Find the matching `{{ endif }}` closing marker and, if present,
    // the `{{ else }}` at the same nesting depth.
    const closeResult = findMatchingInlineEndif(text, parsed.end + 1, rangeEnd, protectedRanges);
    if (!closeResult) {
      // Unmatched conditional; skip past the opening marker.
      searchFrom = parsed.end + 1;
      continue;
    }

    // Evaluate the condition against the current arg context.
    const isTrue = shouldExpandForCondition(parsed.condition, ctx.args, EMPTY_ARGS);
    logger?.log(`inline-if: ${parsed.condition.source}:${parsed.condition.key} → ${isTrue}`);

    // Emit a placeholder for the opening marker so downstream passes
    // can detect that a substitution occurred at this position.
    out += text.slice(cursor, start) + EMPTY_EXPANSION_MARKER;

    // Select and recursively expand the appropriate branch.
    if (closeResult.elseMarker) {
      if (isTrue) {
        // True branch: between the opening marker and `{{ else }}`.
        out += expandInlineConditionalsInRange(
          text,
          parsed.end + 1,
          closeResult.elseMarker.start,
          ctx,
          protectedRanges,
          options,
        );
      } else {
        // False branch: between `{{ else }}` and `{{ endif }}`.
        out += expandInlineConditionalsInRange(
          text,
          closeResult.elseMarker.end + 1,
          closeResult.endif.start,
          ctx,
          protectedRanges,
          options,
        );
      }
    } else {
      if (isTrue) {
        // No else clause; include content between opening and endif when true.
        out += expandInlineConditionalsInRange(
          text,
          parsed.end + 1,
          closeResult.endif.start,
          ctx,
          protectedRanges,
          options,
        );
      }
      // When false with no else clause, the branch body is omitted
      // but template tokens are still replaced with placeholders.
    }
    // Emit a placeholder for the closing marker.
    out += EMPTY_EXPANSION_MARKER;

    cursor = closeResult.endif.end + 1;
    searchFrom = cursor;
    changed = true;
  }

  // Return the reconstructed text if any conditional was expanded;
  // otherwise return the original slice to avoid unnecessary string copies.
  return changed ? out + text.slice(cursor, rangeEnd) : text.slice(rangeStart, rangeEnd);
}
