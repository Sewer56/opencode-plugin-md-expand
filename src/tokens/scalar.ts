import { createDebugLogger } from "../debug";
import type { ResolvedMdExpandOptions } from "../options";
import {
  advanceRangeIndex,
  isInRange,
  mergeRanges,
  remapRanges,
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

/** Cached value for one env variable within a scalar expansion pass. */
interface EnvExpansionValue {
  /** Raw process.env value, or empty string when unset. */
  rawValue: string;
  /** Replacement text, including the empty-expansion marker when raw value is empty. */
  value: string;
  /** Whether the raw value contains a file template. */
  hasFileTemplate: boolean;
  /** Whether the raw value contains an inline conditional template. */
  hasInlineConditionalTemplate: boolean;
}

/**
 * Result of combined arg/env scalar token expansion.
 *
 * Carries the expanded text, protected ranges that must not be scanned in
 * later passes, file-arg ranges for file-template boundary tracking, and
 * flags indicating whether file or inline-conditional templates were detected.
 *
 * @example
 * ```ts
 * // Input: "Hello {{arg:name}}, home: {{env:HOME}}"
 * // Args: new Map([["name", "Alice"]])
 * // Result: { text: "Hello Alice, home: /home/alice", protectedRanges: [], fileArgRanges: [], ... }
 * ```
 */
interface ScalarExpandResult {
  /** The expanded text with arg and env tokens substituted. */
  text: string;
  /**
   * Protected ranges covering expanded arg values that must not be rescanned.
   * Created when an arg value contains token delimiters like `{{` or `}}`.
   *
   * @example
   * ```ts
   * // Input: "Hello {{arg:name}}" with args = new Map([["name", "{{nested}}"]])
   * // The expanded "{{nested}}" is protected so it won't be scanned again
   * // protectedRanges = [{ start: 6, end: 16 }] // covers "{{nested}}"
   * ```
   */
  protectedRanges: ProtectedRange[];
  /**
   * Ranges covering non-file argument values in `{{ file="..." key=value }}`
   * templates that must stay literal during env expansion.
   *
   * @example
   * ```ts
   * // Input: '{{ file="./tmpl" x="{{env:FOO}}" }}'
   * // The `{{env:FOO}}` span is protected so it remains literal for the
   * // imported file template, not expanded in the parent context.
   * // fileArgRanges = [{ start: 22, end: 34 }] // covers "{{env:FOO}}"
   * ```
   */
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
 *
 * @example
 * ```ts
 * // Arg expansion: "Hello {{arg:name}}!" with args=new Map([["name", "World"]])
 * // → "Hello World!"
 *
 * // Env expansion: "Path: {{env:PATH}}" reads from process.env.PATH
 * // → "Path: /usr/bin:/bin:..."
 *
 * // Nested: "{{arg:prefix}}-{{env:SUFFIX}}" expands arg first, then env
 * // If args.prefix = "{{env:BASE}}" and process.env.BASE = "foo", process.env.SUFFIX = "bar"
 * // → "foo-bar"
 * ```
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
      // Translate original-text offsets to the post-arg-expansion output.
      // `out.length` is the current output size; `start - cursor` is the token's
      // offset from the last-consumed position in the original text.
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
  // Shared env-value cache so both the fast-path and fallback loops avoid
  // redundant process.env reads and template-detection scans.
  const envCache = new Map<string, EnvExpansionValue>();

  // Fallback: malformed token invalidated pending-env offsets; rescan from scratch.
  if (needsEnvScan) {
    return expandEnvTokensInText(
      argText,
      argProtectedRanges,
      fileArgRanges,
      hasFile,
      hasInline,
      logger,
      envCache,
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

    const envValue = getEnvExpansionValue(token.varName, envCache);
    const { rawValue, value } = envValue;
    logger?.log(`env: ${token.varName} → ${rawValue ? "<set>" : "<unset>"}`);

    // Check expanded env values for nested file/conditional templates so the
    // caller knows whether to run subsequent expansion passes.
    if (rawValue.length) {
      if (!hasFile && envValue.hasFileTemplate) hasFile = true;
      if (!hasInline && envValue.hasInlineConditionalTemplate) hasInline = true;
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
 *
 * @param text - The arg-expanded text to scan for `{{env:...}}` tokens.
 * @param protectedRanges - Ranges covering expanded arg values that must not be rescanned.
 * @param fileArgRanges - Ranges covering non-file argument values in `{{ file="..." }}` templates that must stay literal.
 * @param hasFile - Current file-template detection flag to update if found.
 * @param hasInline - Current inline-conditional detection flag to update if found.
 * @param logger - Optional debug logger for expansion tracing.
 * @param envCache - Shared per-pass cache for env variable lookups and template detection.
 *
 * @example
 * ```ts
 * // Triggered by malformed token: "{{env:UNCLOSED some text {{env:VALID}}"
 * // Fast path fails; this function rescans to find {{env:VALID}} while skipping protected ranges
 * ```
 */
function expandEnvTokensInText(
  text: string,
  protectedRanges: ProtectedRange[],
  fileArgRanges: ProtectedRange[],
  hasFile: boolean,
  hasInline: boolean,
  logger: ReturnType<typeof createDebugLogger> | undefined,
  envCache: Map<string, EnvExpansionValue>,
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
    const envValue = getEnvExpansionValue(varName, envCache);
    const { rawValue, value } = envValue;
    logger?.log(`env: ${varName} → ${rawValue ? "<set>" : "<unset>"}`);

    // Check expanded env values for nested file/conditional templates so the
    // caller knows whether to run subsequent expansion passes.
    if (rawValue.length) {
      if (!hasFile && envValue.hasFileTemplate) hasFile = true;
      if (!hasInline && envValue.hasInlineConditionalTemplate) hasInline = true;
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
 * Look up an env variable's expansion value, caching the result so repeated
 * occurrences of the same `{{env:VAR}}` avoid redundant `process.env` reads
 * and template-detection scans.
 *
 * @param varName - Environment variable name (the text between `{{env:` and `}}`).
 * @param cache - Per-pass cache that survives across both the fast-path and
 *   fallback env expansion loops.
 * @returns The resolved env value with pre-computed template-detection flags.
 *
 * @example
 * ```ts
 * // process.env.HOME = "/home/alice"
 * getEnvExpansionValue("HOME", cache)
 * // → { rawValue: "/home/alice", value: "/home/alice", hasFileTemplate: false, ... }
 *
 * // process.env.UNSET = undefined
 * getEnvExpansionValue("UNSET", cache)
 * // → { rawValue: "", value: "{{__EMPTY__}}", hasFileTemplate: false, ... }
 * ```
 */
function getEnvExpansionValue(
  varName: string,
  cache: Map<string, EnvExpansionValue>,
): EnvExpansionValue {
  const cached = cache.get(varName);
  if (cached) return cached;

  const rawValue = process.env[varName] ?? "";
  const value = rawValue.length ? rawValue : EMPTY_EXPANSION_MARKER;
  const envValue: EnvExpansionValue = {
    rawValue,
    value,
    hasFileTemplate: rawValue.length ? hasFileTemplate(rawValue) : false,
    hasInlineConditionalTemplate: rawValue.length ? hasInlineConditionalTemplate(rawValue) : false,
  };

  cache.set(varName, envValue);
  return envValue;
}
