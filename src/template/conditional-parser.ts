import { advanceRangeIndex, isInRange, type ProtectedRange } from "../ranges";
import { FILE_TEMPLATE_START, FILE_TEMPLATE_END, IF_ATTR, ENDIF_ATTR } from "../token-syntax";
import type { IfCondition } from "./conditions";
import { parseIfCondition } from "./conditions";
import { skipTemplateSpace, scanTemplateKey, readTemplateValue } from "./scanner";

interface InlineIfTemplateSpec {
  condition: IfCondition;
  /** Inclusive offset of the second `}` in the opening `{{ if=... }}` marker. */
  end: number;
}

interface InlineEndifTemplateSpec {
  /** Inclusive offset of the first `{` in the closing `{{ endif }}` marker. */
  start: number;
  /** Inclusive offset of the second `}` in the closing `{{ endif }}` marker. */
  end: number;
}

interface InlineElseTemplateSpec {
  /** Inclusive offset of the first `{` in the `{{ else }}` marker. */
  start: number;
  /** Inclusive offset of the second `}` in the `{{ else }}` marker. */
  end: number;
}

interface InlineIfCloseResult {
  /** The `{{ endif }}` that closes the block. */
  endif: InlineEndifTemplateSpec;
  /** The `{{ else }}` at the same depth, if present. */
  elseMarker?: InlineElseTemplateSpec;
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
  let depth = 1;
  let searchFrom = searchStart;
  let protectedIndex = advanceRangeIndex(protectedRanges, 0, searchStart);
  let elseMarker: InlineElseTemplateSpec | undefined;

  while (searchFrom < rangeEnd) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom);
    if (start === -1 || start >= rangeEnd) return undefined;

    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start);
    if (isInRange(protectedRanges, protectedIndex, start)) {
      searchFrom = protectedRanges[protectedIndex].end;
      continue;
    }

    const nested = parseInlineIfTemplate(text, start, protectedRanges);
    if (nested && nested.end + 1 <= rangeEnd) {
      depth++;
      searchFrom = nested.end + 1;
      continue;
    }

    const elseParsed = parseInlineElseTemplate(text, start);
    if (elseParsed && elseParsed.end + 1 <= rangeEnd) {
      if (depth === 1 && !elseMarker) {
        elseMarker = elseParsed;
      }
      searchFrom = elseParsed.end + 1;
      continue;
    }

    const closing = parseInlineEndifTemplate(text, start);
    if (closing && closing.end + 1 <= rangeEnd) {
      depth--;
      if (depth === 0) return { endif: closing, elseMarker };
      searchFrom = closing.end + 1;
      continue;
    }

    searchFrom = start + FILE_TEMPLATE_START.length;
  }

  return undefined;
}

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
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined;

  let i = start + FILE_TEMPLATE_START.length;
  i = skipTemplateSpace(text, i);

  const keyStart = i;
  i = scanTemplateKey(text, i);
  if (i === keyStart || text.slice(keyStart, i) !== IF_ATTR) return undefined;

  i = skipTemplateSpace(text, i);
  if (text.charCodeAt(i) !== 61) return undefined; // =
  i = skipTemplateSpace(text, i + 1);

  const value = readTemplateValue(text, i, protectedRanges);
  if (!value) return undefined;
  const condition = parseIfCondition(value.value);
  if (!condition) return undefined;
  i = skipTemplateSpace(text, value.next);

  if (!text.startsWith(FILE_TEMPLATE_END, i)) return undefined;
  return { condition, end: i + FILE_TEMPLATE_END.length - 1 };
}

/**
 * Parse an inline conditional closing marker: `{{ endif }}`.
 *
 * Closing markers accept surrounding whitespace but no attributes. Non-matching
 * `{{ ... }}` text returns `undefined` so other template forms can coexist.
 */
function parseInlineEndifTemplate(
  text: string,
  start: number,
): InlineEndifTemplateSpec | undefined {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined;

  let i = start + FILE_TEMPLATE_START.length;
  i = skipTemplateSpace(text, i);

  const keyStart = i;
  i = scanTemplateKey(text, i);
  if (i === keyStart || text.slice(keyStart, i) !== ENDIF_ATTR) return undefined;

  i = skipTemplateSpace(text, i);
  if (!text.startsWith(FILE_TEMPLATE_END, i)) return undefined;
  return { start, end: i + FILE_TEMPLATE_END.length - 1 };
}

const ELSE_ATTR = "else";

/**
 * Parse an inline else marker: `{{ else }}`.
 *
 * Else markers accept surrounding whitespace but no attributes. Non-matching
 * `{{ ... }}` text returns `undefined` so other template forms can coexist.
 */
function parseInlineElseTemplate(text: string, start: number): InlineElseTemplateSpec | undefined {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined;

  let i = start + FILE_TEMPLATE_START.length;
  i = skipTemplateSpace(text, i);

  const keyStart = i;
  i = scanTemplateKey(text, i);
  if (i === keyStart || text.slice(keyStart, i) !== ELSE_ATTR) return undefined;

  i = skipTemplateSpace(text, i);
  if (!text.startsWith(FILE_TEMPLATE_END, i)) return undefined;
  return { start, end: i + FILE_TEMPLATE_END.length - 1 };
}
