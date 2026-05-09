import { createDebugLogger } from "../debug";
import type { ResolvedMdExpandOptions } from "../options";
import { advanceRangeIndex, isInRange } from "../ranges";
import { parseInlineIfTemplate, findMatchingInlineEndif } from "../template/conditional-parser";
import { shouldExpandForCondition } from "../template/conditions";
import { FILE_TEMPLATE_START, EMPTY_EXPANSION_MARKER, EMPTY_ARGS } from "../token-syntax";
import type { ExpandContext, ProtectedRange } from "../types";

/**
 * Expand inline conditional blocks in already arg/env-expanded text.
 */
export function expandInlineConditionals(
  text: string,
  ctx: ExpandContext,
  protectedRanges: ProtectedRange[],
  options?: ResolvedMdExpandOptions,
): string {
  if (text.indexOf(FILE_TEMPLATE_START) === -1) return text;
  return expandInlineConditionalsInRange(text, 0, text.length, ctx, protectedRanges, options);
}

function expandInlineConditionalsInRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  ctx: ExpandContext,
  protectedRanges: ProtectedRange[],
  options?: ResolvedMdExpandOptions,
): string {
  const logger = options ? createDebugLogger(options) : undefined;
  let out = "";
  let cursor = rangeStart;
  let searchFrom = rangeStart;
  let protectedIndex = advanceRangeIndex(protectedRanges, 0, rangeStart);
  let changed = false;

  while (searchFrom < rangeEnd) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom);
    if (start === -1 || start >= rangeEnd) break;

    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start);
    if (isInRange(protectedRanges, protectedIndex, start)) {
      searchFrom = protectedRanges[protectedIndex].end;
      continue;
    }

    const parsed = parseInlineIfTemplate(text, start, protectedRanges);
    if (!parsed || parsed.end + 1 > rangeEnd) {
      searchFrom = start + FILE_TEMPLATE_START.length;
      continue;
    }

    const closeResult = findMatchingInlineEndif(text, parsed.end + 1, rangeEnd, protectedRanges);
    if (!closeResult) {
      searchFrom = parsed.end + 1;
      continue;
    }

    const isTrue = shouldExpandForCondition(parsed.condition, ctx.args, EMPTY_ARGS);
    logger?.log(`inline-if: ${parsed.condition.source}:${parsed.condition.key} → ${isTrue}`);
    out += text.slice(cursor, start) + EMPTY_EXPANSION_MARKER;

    if (closeResult.elseMarker) {
      if (isTrue) {
        out += expandInlineConditionalsInRange(
          text,
          parsed.end + 1,
          closeResult.elseMarker.start,
          ctx,
          protectedRanges,
          options,
        );
      } else {
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
        out += expandInlineConditionalsInRange(
          text,
          parsed.end + 1,
          closeResult.endif.start,
          ctx,
          protectedRanges,
          options,
        );
      }
    }
    out += EMPTY_EXPANSION_MARKER;

    cursor = closeResult.endif.end + 1;
    searchFrom = cursor;
    changed = true;
  }

  return changed ? out + text.slice(cursor, rangeEnd) : text.slice(rangeStart, rangeEnd);
}
