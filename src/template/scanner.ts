import { advanceRangeIndex, isInRange, type ProtectedRange } from "../ranges";
import { FILE_TEMPLATE_END } from "../token-syntax";

/**
 * Parsed value result from reading a quoted or unquoted template attribute value.
 */
interface TemplateValue {
  value: string;
  valueStart: number;
  valueEnd: number;
  next: number;
}

/**
 * Advance `i` past any template whitespace characters.
 *
 * @param text - Source text being scanned.
 * @param i    - Current scan index.
 * @returns Index of the first non-whitespace character (may equal text.length).
 */
export function skipTemplateSpace(text: string, i: number): number {
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++;
  return i;
}

/**
 * Template attrs may span lines; any common ASCII whitespace separates items.
 *
 * @param code - Character code to test.
 * @returns `true` when `code` is space, tab, LF, or CR.
 */
export function isTemplateSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/**
 * Scan a template attribute key starting at `i` and return the index
 * immediately after the last key character.
 *
 * Returns `i` unchanged when the character at `i` is not a valid key start.
 *
 * @param text - Source text being scanned.
 * @param i    - Index of the first character of the key.
 * @returns Index immediately after the last key character.
 */
export function scanTemplateKey(text: string, i: number): number {
  if (i >= text.length || !isArgKeyStart(text.charCodeAt(i))) return i;
  i++;
  while (i < text.length && isArgKeyChar(text.charCodeAt(i))) i++;
  return i;
}

/**
 * Read a quoted or unquoted template attribute value starting at `start`.
 *
 * Delegates to {@link readQuotedTemplateValue} when the opening character is
 * a double-quote (`"`); otherwise delegates to {@link readUnquotedTemplateValue}.
 *
 * # Errors
 *
 * Returns `undefined` when `start` exceeds `text.length` or when a quoted
 * value is never terminated by a closing double-quote.
 *
 * @param text - Source text being scanned.
 * @param start - Index of the first character of the value.
 * @param protectedRanges - Sorted ranges that the scanner must skip over.
 * @returns The parsed value with its span and next-index, or `undefined`.
 */
export function readTemplateValue(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
): TemplateValue | undefined {
  if (start > text.length) return undefined;
  if (text.charCodeAt(start) === 34) return readQuotedTemplateValue(text, start, protectedRanges); // "
  return readUnquotedTemplateValue(text, start, protectedRanges);
}

/**
 * Validate `[a-zA-Z_][a-zA-Z0-9_-]*` without regex allocation.
 *
 * @param key - Candidate attribute key.
 * @returns `true` when `key` matches the allowed identifier pattern.
 */
export function isValidArgKey(key: string): boolean {
  if (key.length === 0) return false;
  if (!isArgKeyStart(key.charCodeAt(0))) return false;
  for (let i = 1; i < key.length; i++) {
    if (!isArgKeyChar(key.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Validate environment variable keys used by `if=env:NAME` conditions.
 *
 * Unlike {@link isValidArgKey}, hyphens are not permitted.
 *
 * @param key - Candidate environment variable name.
 * @returns `true` when `key` matches `[a-zA-Z_][a-zA-Z0-9_]*`.
 */
export function isValidEnvKey(key: string): boolean {
  if (key.length === 0) return false;
  if (!isArgKeyStart(key.charCodeAt(0))) return false;
  for (let i = 1; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (!isArgKeyStart(code) && (code < 48 || code > 57)) return false;
  }
  return true;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Read a double-quoted template value, processing backslash escapes and
 * skipping protected ranges. Returns `undefined` when the closing quote
 * is never found.
 */
function readQuotedTemplateValue(
  text: string,
  quoteStart: number,
  protectedRanges: ProtectedRange[],
): TemplateValue | undefined {
  let i = quoteStart + 1; // skip opening quote
  let chunkStart = i;
  let value: string | undefined; // lazy string builder; undefined means no escapes seen yet
  let protectedIndex = 0;

  while (i < text.length) {
    // Advance the protected-range cursor to the range that covers (or follows) position i
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, i);
    if (isInRange(protectedRanges, protectedIndex, i)) {
      // Skip over the entire protected region
      i = protectedRanges[protectedIndex].end;
      continue;
    }

    const code = text.charCodeAt(i);
    if (code === 92) {
      // Backslash escape: accumulate the unescaped text so far
      if (value === undefined) value = "";
      value += text.slice(chunkStart, i) + decodeTemplateEscape(text.charCodeAt(i + 1));
      i += i + 1 < text.length ? 2 : 1; // consume escape sequence (or lone backslash at end)
      chunkStart = i;
      continue;
    }
    if (code === 34) {
      // Closing double-quote: return the final assembled value
      return {
        value:
          value === undefined ? text.slice(quoteStart + 1, i) : value + text.slice(chunkStart, i),
        valueStart: quoteStart + 1,
        valueEnd: i,
        next: i + 1,
      };
    }
    i++;
  }

  // Unterminated quoted value
  return undefined;
}

/**
 * Read an unquoted template value up to the next whitespace or end token,
 * skipping protected ranges. Unquoted values may be empty and are never
 * considered unterminated.
 */
function readUnquotedTemplateValue(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
): TemplateValue {
  let i = start;
  let protectedIndex = 0;
  while (i < text.length) {
    // Advance the protected-range cursor to the range that covers (or follows) position i
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, i);
    if (isInRange(protectedRanges, protectedIndex, i)) {
      // Skip over the entire protected region
      i = protectedRanges[protectedIndex].end;
      continue;
    }

    const code = text.charCodeAt(i);
    // Unquoted values end at whitespace or the file-template-end token
    if (isTemplateSpace(code) || text.startsWith(FILE_TEMPLATE_END, i)) break;
    i++;
  }

  const raw = text.slice(start, i);
  return {
    // Fast path: avoid escape scanning when no backslash is present
    value: raw.indexOf("\\") === -1 ? raw : decodeTemplateEscapes(raw),
    valueStart: start,
    valueEnd: i,
    next: i,
  };
}

/** Walk `text`, replacing each backslash-escape sequence with its decoded character. */
function decodeTemplateEscapes(text: string): string {
  let out = "";
  let chunkStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 92) continue; // skip non-backslash characters
    // Append the chunk before this escape, then the decoded escape character
    out += text.slice(chunkStart, i) + decodeTemplateEscape(text.charCodeAt(i + 1));
    i += i + 1 < text.length ? 1 : 0; // skip the character after backslash (or do nothing at end)
    chunkStart = i + 1;
  }
  return out + text.slice(chunkStart);
}

/**
 * Map a backslash-escape character code to its decoded string value.
 * Handles `" \ b f n r t v`, falling back to the literal character.
 */
function decodeTemplateEscape(code: number): string {
  if (Number.isNaN(code)) return "\\";
  switch (code) {
    case 34:
      return '"';
    case 92:
      return "\\";
    case 98:
      return "\b";
    case 102:
      return "\f";
    case 110:
      return "\n";
    case 114:
      return "\r";
    case 116:
      return "\t";
    case 118:
      return "\v";
    default:
      return String.fromCharCode(code);
  }
}

/** Check whether `code` is a valid continuation character for an arg key (letter, digit, hyphen, or underscore). */
function isArgKeyChar(code: number): boolean {
  return isArgKeyStart(code) || code === 45 || (code >= 48 && code <= 57);
}

/** Check whether `code` is a valid start character for an arg key (letter or underscore). */
function isArgKeyStart(code: number): boolean {
  return code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
