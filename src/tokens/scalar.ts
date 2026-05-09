import { createDebugLogger } from "../debug";
import type { ResolvedMdExpandOptions } from "../options";
import {
  advanceRangeIndex,
  isInRange,
  mergeRanges,
  type ProtectedRange,
  type ReplacementRange,
} from "../ranges";
import {
  hasFileTemplate,
  hasInlineConditionalTemplate,
  startsFileTemplate,
  startsInlineIfTemplate,
} from "../template/detection";
import { collectFileArgRanges } from "../template/file-parser";
import {
  ARG_PREFIX,
  EMPTY_EXPANSION_MARKER,
  EMPTY_RANGES,
  ENV_PREFIX,
  FILE_TEMPLATE_START,
  TOKEN_END,
  TOKEN_START,
} from "../token-syntax";

/** Deferred env token recorded during the arg pass so the env pass can patch known spans. */
interface PendingEnvToken {
  /** Start offset (inclusive) in the post-arg-pass output. */
  start: number;
  /** End offset (exclusive) in the post-arg-pass output. */
  end: number;
  /** Environment variable name between the prefix and `TOKEN_END`. */
  varName: string;
}

/**
 * Result of combined arg/env scalar token expansion.
 *
 * Carries the expanded text, protected ranges that must not be scanned in
 * later passes, file-arg ranges for file-template boundary tracking, and
 * flags indicating whether file or inline-conditional templates were detected.
 */
export interface ScalarExpandResult {
  /** The expanded text with arg and env tokens substituted. */
  text: string;
  /** Protected ranges from arg-literal values that must not be rescanned. */
  protectedRanges: ProtectedRange[];
  /** Ranges inside file-template `file="..."` args that must stay literal during env expansion. */
  fileArgRanges: ProtectedRange[];
  /** Whether `fileArgRanges` has been collected for this text. */
  fileArgRangesCollected: boolean;
  /** Whether a `{{ file=... }}` template was detected in the text or any expanded value. */
  hasFileTemplate: boolean;
  /** Whether an `{{ if=... }}` inline conditional was detected in the text or any expanded value. */
  hasInlineConditionalTemplate: boolean;
}

/**
 * Expand synchronous scalar tokens in arg-first/env-second order.
 *
 * This keeps the public expansion semantics of the old two-pass arg/env
 * pipeline, but records env token spans during the arg pass so the env pass can
 * patch known spans instead of scanning the whole string again. File-template
 * arg ranges are collected once after arg expansion so env tokens inside
 * template args remain literal for the imported file.
 *
 * @param text - Source text containing `{{arg:...}}` and `{{env:...}}` tokens.
 * @param args - Map of arg names to their replacement values.
 * @param options - Resolved expansion options.
 * @returns The expanded text, protected/file-arg ranges, and template-detection flags.
 */
export function expandScalarTokens(
  text: string,
  args: Map<string, string>,
  options?: ResolvedMdExpandOptions,
): ScalarExpandResult {
  const logger = options?.debug ? createDebugLogger(options) : undefined;
  let pendingEnv: PendingEnvToken[] | undefined;
  let protectedRanges: ProtectedRange[] | undefined;

  let out = "";
  let cursor = 0;
  let searchFrom = 0;
  let changed = false;
  let hasFile = false;
  let hasInline = false;
  let expandArgs = true;
  let recordEnv = true;
  let needsEnvScan = false;

  // Single scan finds both arg and env tokens since they share the `{{` prefix.
  while (true) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom);
    if (start === -1) break;

    if (expandArgs && text.startsWith(ARG_PREFIX, start)) {
      const valueStart = start + ARG_PREFIX.length;
      const end = text.indexOf(TOKEN_END, valueStart);
      if (end === -1) {
        // Unclosed arg prefix - stop arg expansion; remaining positions are unreliable.
        expandArgs = false;
        searchFrom = start + 1;
        continue;
      }

      const key = text.slice(valueStart, end);
      const found = args.has(key);
      const rawValue = found ? args.get(key)! : "";
      const value = rawValue.length ? rawValue : EMPTY_EXPANSION_MARKER;
      logger?.log(`arg: ${key} → ${found ? value : "<undefined>"}`);

      out += text.slice(cursor, start);
      const outStart = out.length;
      out += value;

      // Protect expanded values that contain token delimiters from later expansion passes.
      if (value.indexOf(TOKEN_START) !== -1 || value.indexOf(TOKEN_END) !== -1) {
        protectedRanges ??= [];
        protectedRanges.push({ start: outStart, end: outStart + value.length });
      }

      cursor = end + TOKEN_END.length;
      searchFrom = cursor;
      changed = true;
      continue;
    }

    if (recordEnv && text.startsWith(ENV_PREFIX, start)) {
      const valueStart = start + ENV_PREFIX.length;
      const end = text.indexOf(TOKEN_END, valueStart);
      if (end === -1) {
        // Unclosed env prefix - invalidate pending-env fast path; full rescan required.
        recordEnv = false;
        needsEnvScan = true;
        searchFrom = start + 1;
        continue;
      }

      if (end === valueStart) {
        // Skip empty `{{env:}}` tokens (no variable name).
        searchFrom = valueStart;
        continue;
      }

      // If an arg prefix is nested inside this env token, positions shift and
      // the pending-env fast path breaks; fall back to a full env rescan.
      const nestedArg = text.indexOf(ARG_PREFIX, valueStart);
      if (nestedArg !== -1 && nestedArg < end) {
        needsEnvScan = true;
        searchFrom = valueStart;
        continue;
      }

      // Record env token with offsets mapped into the post-arg-expansion output,
      // since arg expansion may have shifted positions relative to the source text.
      pendingEnv ??= [];
      pendingEnv.push({
        start: out.length + start - cursor,
        end: out.length + end + TOKEN_END.length - cursor,
        varName: text.slice(valueStart, end),
      });
      searchFrom = end + TOKEN_END.length;
      continue;
    }

    if (!hasFile && startsFileTemplate(text, start)) hasFile = true;
    if (!hasInline && startsInlineIfTemplate(text, start)) hasInline = true;

    searchFrom = start + 1;
  }

  const argText = changed ? out + text.slice(cursor) : text;
  const argProtectedRanges = protectedRanges ?? EMPTY_RANGES;

  // Fast path: no env tokens found and no need for full rescan.
  if (!pendingEnv?.length && !needsEnvScan) {
    return {
      text: argText,
      protectedRanges: argProtectedRanges,
      fileArgRanges: EMPTY_RANGES,
      fileArgRangesCollected: false,
      hasFileTemplate: hasFile,
      hasInlineConditionalTemplate: hasInline,
    };
  }

  const fileArgRanges = collectFileArgRanges(argText, argProtectedRanges);

  // Fallback: malformed token invalidated pending-env offsets; rescan from scratch.
  if (needsEnvScan) {
    return expandEnvTokensInText(
      argText,
      argProtectedRanges,
      fileArgRanges,
      hasFile,
      hasInline,
      logger,
    );
  }

  // Apply pending env tokens using the fast-path offset list,
  // skipping any that fall inside protected or file-arg ranges.
  const skipRanges = mergeRanges(argProtectedRanges, fileArgRanges);
  const envTokens = pendingEnv!;
  const replacements: ReplacementRange[] = [];
  let skipIndex = 0;
  out = "";
  cursor = 0;
  changed = false;

  for (const token of envTokens) {
    skipIndex = advanceRangeIndex(skipRanges, skipIndex, token.start);
    if (isInRange(skipRanges, skipIndex, token.start)) continue;

    const rawValue = process.env[token.varName] ?? "";
    const value = rawValue.length ? rawValue : EMPTY_EXPANSION_MARKER;
    logger?.log(`env: ${token.varName} → ${rawValue ? "<set>" : "<unset>"}`);

    // Check expanded env values for nested file/conditional templates so the
    // caller knows whether to run subsequent expansion passes.
    if (rawValue.length) {
      if (!hasFile && hasFileTemplate(rawValue)) hasFile = true;
      if (!hasInline && hasInlineConditionalTemplate(rawValue)) hasInline = true;
    }

    out += argText.slice(cursor, token.start) + value;
    replacements.push({ start: token.start, end: token.end, length: value.length });
    cursor = token.end;
    changed = true;
  }

  if (!changed) {
    return {
      text: argText,
      protectedRanges: argProtectedRanges,
      fileArgRanges,
      fileArgRangesCollected: true,
      hasFileTemplate: hasFile,
      hasInlineConditionalTemplate: hasInline,
    };
  }

  return {
    text: out + argText.slice(cursor),
    protectedRanges: remapRanges(argProtectedRanges, replacements),
    fileArgRanges: remapRanges(fileArgRanges, replacements),
    fileArgRangesCollected: true,
    hasFileTemplate: hasFile,
    hasInlineConditionalTemplate: hasInline,
  };
}

/**
 * Fallback env-only expansion that rescans the full text for `{{env:...}}` tokens.
 *
 * Used when the fast path (deferred pending-env tokens) is invalid because a
 * malformed token appeared before valid env tokens, requiring a full scan of
 * the arg-expanded text while skipping protected and file-arg ranges.
 */
function expandEnvTokensInText(
  text: string,
  protectedRanges: ProtectedRange[],
  fileArgRanges: ProtectedRange[],
  hasFile: boolean,
  hasInline: boolean,
  logger: ReturnType<typeof createDebugLogger> | undefined,
): ScalarExpandResult {
  const skipRanges = mergeRanges(protectedRanges, fileArgRanges);
  const replacements: ReplacementRange[] = [];
  let skipIndex = 0;
  let out = "";
  let cursor = 0;
  let searchFrom = 0;
  let changed = false;

  while (true) {
    const start = text.indexOf(ENV_PREFIX, searchFrom);
    if (start === -1) break;

    skipIndex = advanceRangeIndex(skipRanges, skipIndex, start);
    if (isInRange(skipRanges, skipIndex, start)) {
      searchFrom = skipRanges[skipIndex].end;
      continue;
    }

    const valueStart = start + ENV_PREFIX.length;
    const end = text.indexOf(TOKEN_END, valueStart);
    if (end === -1) break;

    if (end === valueStart) {
      // Skip empty `{{env:}}` tokens (no variable name).
      searchFrom = valueStart;
      continue;
    }

    const varName = text.slice(valueStart, end);
    const rawValue = process.env[varName] ?? "";
    const value = rawValue.length ? rawValue : EMPTY_EXPANSION_MARKER;
    logger?.log(`env: ${varName} → ${rawValue ? "<set>" : "<unset>"}`);

    // Check expanded env values for nested file/conditional templates so the
    // caller knows whether to run subsequent expansion passes.
    if (rawValue.length) {
      if (!hasFile && hasFileTemplate(rawValue)) hasFile = true;
      if (!hasInline && hasInlineConditionalTemplate(rawValue)) hasInline = true;
    }

    out += text.slice(cursor, start) + value;
    replacements.push({ start, end: end + TOKEN_END.length, length: value.length });
    cursor = end + TOKEN_END.length;
    searchFrom = cursor;
    changed = true;
  }

  if (!changed) {
    return {
      text,
      protectedRanges,
      fileArgRanges,
      fileArgRangesCollected: true,
      hasFileTemplate: hasFile,
      hasInlineConditionalTemplate: hasInline,
    };
  }

  return {
    text: out + text.slice(cursor),
    protectedRanges: remapRanges(protectedRanges, replacements),
    fileArgRanges: remapRanges(fileArgRanges, replacements),
    fileArgRangesCollected: true,
    hasFileTemplate: hasFile,
    hasInlineConditionalTemplate: hasInline,
  };
}

/**
 * Adjust protected/file-arg range offsets after text replacements shift positions.
 *
 * Walks sorted ranges alongside sorted replacements, accumulating a running
 * delta (replacement length minus replaced span length) and shifting each range
 * by the cumulative delta of all replacements that end before the range starts.
 * Assumes replacements and ranges are both sorted by start offset ascending.
 */
function remapRanges(ranges: ProtectedRange[], replacements: ReplacementRange[]): ProtectedRange[] {
  if (!ranges.length || !replacements.length) return ranges;

  const out: ProtectedRange[] = [];
  let replacementIndex = 0;
  let delta = 0;
  for (const range of ranges) {
    while (
      replacementIndex < replacements.length &&
      replacements[replacementIndex].end <= range.start
    ) {
      const replacement = replacements[replacementIndex];
      delta += replacement.length - (replacement.end - replacement.start);
      replacementIndex++;
    }
    out.push({ start: range.start + delta, end: range.end + delta });
  }
  return out;
}
