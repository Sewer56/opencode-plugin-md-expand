import path from "node:path";

import { createDebugLogger } from "../debug";
import { expand } from "../expand";
import type { ExpandContext } from "../expand";
import type { ResolvedMdExpandOptions } from "../options";
import { resolvePath } from "../path-resolver";
import { advanceRangeIndex, isInRange, type ProtectedRange } from "../ranges";
import { shouldExpandForCondition } from "../template/conditions";
import { hasExpandableToken } from "../template/detection";
import { parseFileTemplate } from "../template/file-parser";
import { FILE_TEMPLATE_START, EMPTY_EXPANSION_MARKER, MAX_DEPTH } from "../token-syntax";

/**
 * Expand all `{{ file="path" }}` templates in `text`, including optional
 * `if=condition` and `key=value` argument attributes.
 *
 * Scans for file-template tokens outside protected ranges, resolves each path
 * relative to `baseDir`, reads the target file, and recursively expands its
 * content. Uses shared I/O and expansion caches from `ctx` to avoid redundant
 * work across nested calls. Cycles are detected via `ctx.visited` and produce
 * a diagnostic plus an empty-marker replacement.
 *
 * @param text            - Source text containing zero or more file templates.
 * @param baseDir         - Absolute directory used to resolve relative file paths.
 * @param ctx             - Shared expansion context carrying caches, visited set,
 *                          argument bindings, and optional diagnostics sink.
 * @param protectedRanges - Sorted, non-overlapping `[start, end)` spans to skip
 *                          (e.g. arg-literal values already substituted).
 * @param options         - Resolved plugin options (debug, configDirs, maxDepth, etc.).
 * @returns The input text with every file template replaced by its expanded content.
 *          Unresolved or errored templates are replaced with the empty-expansion marker.
 *
 * # Errors
 * Rejects if recursive file expansion fails (e.g. a nested `expand()` call
 * rejects). File-read failures, missing targets, and cycle detections are
 * recorded as diagnostics in `ctx.diagnostics` (when present) and the template
 * is replaced with the empty-expansion marker.
 */
export async function expandFileTokens(
  text: string,
  baseDir: string,
  ctx: ExpandContext,
  protectedRanges: ProtectedRange[],
  options?: ResolvedMdExpandOptions,
): Promise<string> {
  const logger = options?.debug ? createDebugLogger(options) : undefined;

  // `parts[i]` holds the text before the i-th template; `reads[i]` is the
  // async promise for that template's expanded content. They are kept
  // parallel so we can batch all I/O with Promise.all at the end.
  const parts: string[] = [];
  const reads: Promise<string>[] = [];

  let cursor = 0; // Offset of the first un-emitted character.
  let searchFrom = 0; // Starting position for the next `indexOf` scan.
  let protectedIndex = 0; // Monotonic cursor into the sorted `protectedRanges`.

  while (true) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom);
    if (start === -1) break;

    // Advance the protected-range cursor past any ranges that end before `start`.
    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start);
    // If the opening `{{` falls inside a protected span, skip past that span.
    if (isInRange(protectedRanges, protectedIndex, start)) {
      searchFrom = protectedRanges[protectedIndex].end;
      continue;
    }

    // Attempt to parse a complete file-template starting at `start`.
    const parsed = parseFileTemplate(text, start, protectedRanges);
    if (!parsed) {
      // Not a valid file-template; advance past the opening `{{` and keep scanning.
      searchFrom = start + FILE_TEMPLATE_START.length;
      continue;
    }

    const { rawPath, args, condition, end } = parsed;
    const token = logger || ctx.diagnostics ? text.slice(start, end + 1) : "";

    // Reject empty file paths early.
    if (rawPath.length === 0) {
      recordDiagnostic(ctx, {
        kind: "empty-file",
        token: text.slice(start, end + 1),
        message: "file template has an empty file path",
      });
      parts.push(text.slice(cursor, start));
      reads.push(Promise.resolve(EMPTY_EXPANSION_MARKER));
      cursor = end + 1;
      searchFrom = cursor;
      continue;
    }

    // Skip expansion when the `if` condition evaluates to false.
    if (!shouldExpandForCondition(condition, ctx.args, args)) {
      logger?.log(`file: ${text.slice(start, end + 1)} SKIPPED (if condition false)`);
      parts.push(text.slice(cursor, start));
      reads.push(Promise.resolve(EMPTY_EXPANSION_MARKER));
      cursor = end + 1;
      searchFrom = cursor;
      continue;
    }

    const resolved = resolvePath(rawPath, baseDir);
    if (args.size > 0) {
      logger?.log(
        `file: ${rawPath} ${formatArgsForCall(args)} → ${resolved} (${args.size} args: ${formatArgsForLog(args)})`,
      );
    }

    // Cycle detection: if the resolved path is already in the ancestor chain,
    // emit a diagnostic and substitute the empty marker instead of reading.
    if (ctx.visited.has(resolved)) {
      logger?.log(`file: ${token} → ${resolved} SKIPPED (cycle detected)`);
      recordDiagnostic(ctx, {
        kind: "cycle",
        token: text.slice(start, end + 1),
        rawPath,
        resolved,
        message: `file template cycle detected for ${resolved}`,
      });
      parts.push(text.slice(cursor, start));
      reads.push(Promise.resolve(EMPTY_EXPANSION_MARKER));
      cursor = end + 1;
      searchFrom = cursor;
      continue;
    }

    // Memoize raw file reads so the same path is read at most once.
    let rawPromise = ctx.readCache.get(resolved);
    if (!rawPromise) {
      rawPromise = readRawFile(resolved, rawPath, token, ctx, options);
      ctx.readCache.set(resolved, rawPromise);
    }

    // Read and recursively expand the file content (with caching).
    const read = readExpandedFile(rawPromise, resolved, baseDir, token, ctx, args, options);

    parts.push(text.slice(cursor, start));
    reads.push(read);
    cursor = end + 1;
    searchFrom = cursor;
  }

  // Fast path: no file templates found.
  if (!reads.length) return text;

  const tail = text.slice(cursor);

  // Strip a single trailing newline from expanded content so the template
  // and surrounding text flow naturally without double blank lines.
  const stripTrailingNewline = (s: string): string => {
    if (s.endsWith("\r\n")) return s.slice(0, -2);
    if (s.endsWith("\n")) return s.slice(0, -1);
    return s;
  };

  // Single-template fast path avoids Promise.all overhead.
  if (reads.length === 1) {
    return parts[0] + stripTrailingNewline(await reads[0]) + tail;
  }

  // Interleave the text-before-template segments with the expanded contents.
  const contents = await Promise.all(reads);
  let out = "";
  for (let i = 0; i < contents.length; i++) {
    out += parts[i] + stripTrailingNewline(contents[i]);
  }
  return out + tail;
}

/**
 * Read and recursively expand a file, optionally reusing a shared
 * expanded-text cache.
 *
 * When `ctx.expandedFileCache` is available the result is cached by a key
 * derived from the resolved path, base directory, depth, max-depth, args,
 * and ancestor chain - so identical requests from sibling templates share
 * work.
 *
 * @param rawPromise - Promise resolving to the raw (unexpanded) file content.
 * @param resolved   - Absolute path of the file (used as cache key and for logging).
 * @param baseDir    - Base directory for resolving nested file references.
 * @param token      - Original template string (for diagnostics/logging only).
 * @param ctx        - Shared expansion context.
 * @param args       - Argument bindings active at this expansion level.
 * @param options    - Resolved plugin options.
 * @returns A promise resolving to the fully expanded file content.
 *
 * # Errors
 * Rejects if recursive expansion of the file content fails (via the nested
 * `expand()` call). On rejection the cache entry is evicted so a subsequent
 * attempt can succeed.
 */
function readExpandedFile(
  rawPromise: Promise<string>,
  resolved: string,
  baseDir: string,
  token: string,
  ctx: ExpandContext,
  args: Map<string, string>,
  options?: ResolvedMdExpandOptions,
): Promise<string> {
  const cache = ctx.expandedFileCache;
  // Bypass caching when no shared cache is available.
  if (!cache)
    return rawPromise.then((raw) =>
      recursivelyExpand(raw, resolved, baseDir, token, ctx, args, options),
    );

  const key = makeExpandedFileCacheKey(resolved, baseDir, ctx, args, options);
  const cached = cache.get(key);
  if (cached) return cached;

  const read = rawPromise
    .then((raw) => recursivelyExpand(raw, resolved, baseDir, token, ctx, args, options))
    .catch((err: unknown) => {
      // Evict the stale entry so a subsequent attempt can retry.
      cache.delete(key);
      throw err;
    });
  cache.set(key, read); // Store the in-flight promise so concurrent callers share one expansion.
  return read;
}

/**
 * Read raw file content (trimmed), with multi-configDir fallback for relative paths.
 *
 * For relative paths that are not found at the primary resolved location, each
 * directory in `options.configDirs` is tried in order. This lets the plugin
 * resolve files relative to multiple config directories.
 *
 * @param resolved - Absolute path of the primary file location.
 * @param rawPath  - Original path string as written in the template.
 * @param token    - Full template token string (for diagnostics/logging).
 * @param ctx      - Shared expansion context.
 * @param options  - Resolved plugin options (debug, configDirs).
 * @returns The trimmed file content, or `EMPTY_EXPANSION_MARKER` when the file
 *          is missing, empty, or unreadable.
 *
 * # Errors
 * Does not throw. ENOENT and other read errors are recorded as diagnostics
 * (when `ctx.diagnostics` is present) and the function returns
 * `EMPTY_EXPANSION_MARKER`.
 */
async function readRawFile(
  resolved: string,
  rawPath: string,
  token: string,
  ctx: ExpandContext,
  options?: ResolvedMdExpandOptions,
): Promise<string> {
  const logger = options?.debug ? createDebugLogger(options) : undefined;

  // Skip when an arg interpolation in the file path was unresolved
  // (the path still contains the sentinel placeholder).
  if (rawPath.includes("FILE_INTERP_EMPTY")) {
    logger?.log(`file: ${token} → skipped (unresolved arg in path)`);
    return EMPTY_EXPANSION_MARKER;
  }
  try {
    const raw = (await Bun.file(resolved).text()).trim();
    logger?.log(`file: ${token} → ${resolved} (${raw.length} chars)`);
    return raw.length ? raw : EMPTY_EXPANSION_MARKER;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const configDirs = options?.configDirs ?? [];
    const canFallback =
      code === "ENOENT" &&
      (rawPath.startsWith("./") || rawPath.startsWith("../")) &&
      configDirs.length > 0;
    if (!canFallback) {
      if (code === "ENOENT") logger?.log(`file: ${token} → ${resolved} DOES NOT EXIST`);
      else logger?.log(`file: ${token} → ${resolved} READ ERROR: ${(err as Error).message}`);
      recordDiagnostic(ctx, {
        kind: code === "ENOENT" ? "missing-file" : "read-error",
        token,
        rawPath,
        resolved,
        message:
          code === "ENOENT"
            ? `file template target does not exist: ${resolved}`
            : `file template read error for ${resolved}: ${(err as Error).message}`,
      });
      return EMPTY_EXPANSION_MARKER;
    }

    // Fallback: try each configDir as an alternative base for relative paths.
    for (const configDir of configDirs) {
      const configResolved = path.resolve(configDir, rawPath);
      if (configResolved === resolved) continue; // Already tried the primary location.
      try {
        const content = (await Bun.file(configResolved).text()).trim();
        logger?.log(
          `file: ${token} → ${configResolved} (${content.length} chars) [config dir fallback]`,
        );
        return content.length ? content : EMPTY_EXPANSION_MARKER;
      } catch (err2: unknown) {
        const code2 = (err2 as NodeJS.ErrnoException)?.code;
        if (code2 !== "ENOENT") {
          logger?.log(`file: ${token} → ${configResolved} READ ERROR: ${(err2 as Error).message}`);
          recordDiagnostic(ctx, {
            kind: "read-error",
            token,
            rawPath,
            resolved: configResolved,
            message: `file template read error for ${configResolved}: ${(err2 as Error).message}`,
          });
          return EMPTY_EXPANSION_MARKER;
        }
        // ENOENT in fallback dir is expected; continue to next candidate.
      }
    }

    logger?.log(
      `file: ${token} → ${resolved} DOES NOT EXIST (tried ${configDirs.length} fallback(s))`,
    );
    recordDiagnostic(ctx, {
      kind: "missing-file",
      token,
      rawPath,
      resolved,
      message: `file template target does not exist: ${resolved}`,
    });
    return EMPTY_EXPANSION_MARKER;
  }
}

/**
 * Append a diagnostic record to the context sink (when present) and log it.
 *
 * @param ctx        - Shared expansion context providing the diagnostics array and logger.
 * @param diagnostic - Diagnostic record to append.
 */
function recordDiagnostic(
  ctx: ExpandContext,
  diagnostic: { kind: string; token: string; rawPath?: string; resolved?: string; message: string },
): void {
  ctx.diagnostics?.push(diagnostic as any);
  ctx.logger?.log(`diagnostic: ${diagnostic.kind} ${diagnostic.token} ${diagnostic.message}`);
}

/**
 * Format args as `key=value` pairs separated by spaces (for debug logging of calls).
 */
function formatArgsForCall(args: Map<string, string>): string {
  let out = "";
  for (const [key, value] of args) {
    if (out) out += " ";
    out += `${key}=${value}`;
  }
  return out;
}

/**
 * Format args as `key=value` pairs separated by commas (for human-readable logging).
 */
function formatArgsForLog(args: Map<string, string>): string {
  let out = "";
  for (const [key, value] of args) {
    if (out) out += ", ";
    out += `${key}=${value}`;
  }
  return out;
}

/**
 * Recursively expand tokens in raw file content if depth allows and tokens exist.
 *
 * @param raw      - Raw file content to expand.
 * @param resolved - Absolute path of the source file (for cycle detection and logging).
 * @param baseDir  - Base directory for resolving nested file references.
 * @param token    - Original template string (for logging only).
 * @param ctx      - Shared expansion context.
 * @param args     - Argument bindings active at this expansion level.
 * @param options  - Resolved plugin options.
 * @returns The recursively expanded content, or `raw` unchanged when no
 *          expandable tokens are present.
 *
 * # Errors
 * Rejects if the nested `expand()` call rejects (e.g. an unhandled error in
 * a deeply nested file template).
 */
async function recursivelyExpand(
  raw: string,
  resolved: string,
  baseDir: string,
  token: string,
  ctx: ExpandContext,
  args: Map<string, string>,
  options?: ResolvedMdExpandOptions,
): Promise<string> {
  const logger = options?.debug ? createDebugLogger(options) : undefined;
  if (!hasExpandableToken(raw)) return raw;
  // Copy the ancestor set and add the current file so nested expansions
  // can detect cycles back to this file.
  const childVisited = new Set(ctx.visited);
  childVisited.add(resolved);
  // Forward the full expansion context to the recursive expand() call.
  const expanded = await expand(raw, baseDir, options, {
    visited: childVisited,
    depth: ctx.depth + 1,
    readCache: ctx.readCache,
    expandedFileCache: ctx.expandedFileCache,
    args,
    diagnostics: ctx.diagnostics,
    options: ctx.options ?? options,
    logger: ctx.logger,
  });
  logger?.log(
    `file: ${token} → ${resolved} recursive expansion (${expanded.length} chars, depth ${ctx.depth + 1})`,
  );
  return expanded;
}

/**
 * Build a cache key for the expanded-file cache. The key encodes the resolved
 * path, base directory, depth, max-depth, sorted args, and sorted ancestor
 * chain so that semantically distinct requests never share a cached result.
 *
 * @param resolved - Absolute path of the file being expanded.
 * @param baseDir  - Base directory used for nested path resolution.
 * @param ctx      - Shared expansion context (depth, visited set, options).
 * @param args     - Argument bindings that affect expansion output.
 * @param options  - Resolved plugin options (provides maxDepth).
 * @returns A JSON string suitable as a Map key.
 */
function makeExpandedFileCacheKey(
  resolved: string,
  baseDir: string,
  ctx: ExpandContext,
  args: Map<string, string>,
  options?: ResolvedMdExpandOptions,
): string {
  const maxDepth = options?.maxDepth ?? ctx.options?.maxDepth ?? MAX_DEPTH;
  return JSON.stringify({
    resolved,
    baseDir,
    depth: ctx.depth + 1,
    maxDepth,
    args: sortedMapEntries(args),
    visited: sortedSetValues(ctx.visited),
  });
}

/**
 * Return map entries sorted by key as `[string, string][]` for deterministic serialization.
 */
function sortedMapEntries(map: Map<string, string>): [string, string][] {
  if (!map.size) return [];
  return [...map.entries()].sort(([left], [right]) => compareStrings(left, right));
}

/**
 * Return set values in sorted lexicographic order as `string[]` for deterministic serialization.
 */
function sortedSetValues(set: Set<string>): string[] {
  if (!set.size) return [];
  return [...set].sort(compareStrings);
}

/**
 * Lexicographic string comparison returning -1, 0, or 1.
 * Used as a comparator for deterministic sorting in cache keys.
 *
 * @param left  - First string to compare.
 * @param right - Second string to compare.
 */
function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
