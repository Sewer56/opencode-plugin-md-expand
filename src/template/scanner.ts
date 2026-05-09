import { advanceRangeIndex, isInRange } from "../ranges";
import { FILE_TEMPLATE_END } from "../token-syntax";
import type { ProtectedRange } from "../types";

/**
 * Parsed value result from reading a quoted or unquoted template attribute value.
 */
interface TemplateValue {
  value: string;
  valueStart: number;
  valueEnd: number;
  next: number;
}

export function skipTemplateSpace(text: string, i: number): number {
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++;
  return i;
}

/** Template attrs may span lines; any common ASCII whitespace separates items. */
export function isTemplateSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

export function scanTemplateKey(text: string, i: number): number {
  if (i >= text.length || !isArgKeyStart(text.charCodeAt(i))) return i;
  i++;
  while (i < text.length && isArgKeyChar(text.charCodeAt(i))) i++;
  return i;
}

export function readTemplateValue(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
): TemplateValue | undefined {
  if (start > text.length) return undefined;
  if (text.charCodeAt(start) === 34) return readQuotedTemplateValue(text, start, protectedRanges); // "
  return readUnquotedTemplateValue(text, start, protectedRanges);
}

/** Validate `[a-zA-Z_][a-zA-Z0-9_-]*` without regex allocation. */
export function isValidArgKey(key: string): boolean {
  if (key.length === 0) return false;
  if (!isArgKeyStart(key.charCodeAt(0))) return false;
  for (let i = 1; i < key.length; i++) {
    if (!isArgKeyChar(key.charCodeAt(i))) return false;
  }
  return true;
}

/** Validate environment variable keys used by `if=env:NAME` conditions. */
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

function readQuotedTemplateValue(
  text: string,
  quoteStart: number,
  protectedRanges: ProtectedRange[],
): TemplateValue | undefined {
  let i = quoteStart + 1;
  let chunkStart = i;
  let value: string | undefined;
  let protectedIndex = 0;

  while (i < text.length) {
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, i);
    if (isInRange(protectedRanges, protectedIndex, i)) {
      i = protectedRanges[protectedIndex].end;
      continue;
    }

    const code = text.charCodeAt(i);
    if (code === 92) {
      // \
      if (value === undefined) value = "";
      value += text.slice(chunkStart, i) + decodeTemplateEscape(text.charCodeAt(i + 1));
      i += i + 1 < text.length ? 2 : 1;
      chunkStart = i;
      continue;
    }
    if (code === 34) {
      // "
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

  return undefined;
}

function readUnquotedTemplateValue(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
): TemplateValue {
  let i = start;
  let protectedIndex = 0;
  while (i < text.length) {
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, i);
    if (isInRange(protectedRanges, protectedIndex, i)) {
      i = protectedRanges[protectedIndex].end;
      continue;
    }

    const code = text.charCodeAt(i);
    if (isTemplateSpace(code) || text.startsWith(FILE_TEMPLATE_END, i)) break;
    i++;
  }

  const raw = text.slice(start, i);
  return {
    value: raw.indexOf("\\") === -1 ? raw : decodeTemplateEscapes(raw),
    valueStart: start,
    valueEnd: i,
    next: i,
  };
}

function decodeTemplateEscapes(text: string): string {
  let out = "";
  let chunkStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 92) continue; // \
    out += text.slice(chunkStart, i) + decodeTemplateEscape(text.charCodeAt(i + 1));
    i += i + 1 < text.length ? 1 : 0;
    chunkStart = i + 1;
  }
  return out + text.slice(chunkStart);
}

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

function isArgKeyChar(code: number): boolean {
  return isArgKeyStart(code) || code === 45 || (code >= 48 && code <= 57);
}

function isArgKeyStart(code: number): boolean {
  return code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
