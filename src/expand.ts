import { createDebugLogger } from "./debug";
import type { DebugLogger } from "./debug";
import type { ResolvedMdExpandOptions } from "./options";
import { mergeRanges } from "./ranges";
import {
  hasExpandableToken,
  hasFileTemplate,
  hasInlineConditionalTemplate,
} from "./template/detection";
import { collectFileArgRanges } from "./template/file-parser";
import { MAX_DEPTH, FILE_TEMPLATE_START, EMPTY_ARGS, EMPTY_EXPANSION_MARKER } from "./token-syntax";
import { expandInlineConditionals } from "./tokens/conditional";
import { expandFileTokens } from "./tokens/file";
import { expandScalarTokens } from "./tokens/scalar";

/**
 * Diagnostic record for a single expansion issue encountered during template processing.
 */
export interface ExpansionDiagnostic {
  /** Diagnostic category indicating the type of issue encountered. */
  kind: "empty-file" | "missing-file" | "read-error" | "cycle";
  /** The full template token string that triggered the diagnostic. */
  token: string;
  /** Original path as written in the template, before resolution. */
  rawPath?: string;
  /** Resolved absolute path if path resolution was attempted. */
  resolved?: string;
  /** Human-readable error message describing the issue. */
  message: string;
}

/**
 * Shared execution context for a single expand() call tree.
 * Carries cycle detection state, read cache, and argument bindings through recursive expansion.
 */
export interface ExpandContext {
  /** Resolved absolute paths of ancestor files in the current recursion chain. */
  visited: Set<string>;
  /** Current recursion depth. Starts at 0 for the root expand() call. */
  depth: number;
  /** Raw I/O cache keyed by resolved absolute path (content before recursive expansion). */
  readCache: Map<string, Promise<string>>;
  /** Caller-provided args scoped to this expansion level. */
  args: Map<string, string>;
  /** Optional diagnostics sink used by validation tooling. Runtime expansion stays silent. */
  diagnostics?: ExpansionDiagnostic[];
  /** Optional resolved options reference for configDirs fallback and logging. */
  options?: ResolvedMdExpandOptions;
  /** Optional debug logger. Set by expand() entry points when options.debug is true. */
  logger?: DebugLogger;
}

/**
 * Result of expandWithDiagnostics() containing expanded text and any issues encountered.
 */
export interface ExpandWithDiagnosticsResult {
  /** The fully expanded template text with all tokens substituted. */
  text: string;
  /** Collection of diagnostics encountered during expansion (empty in normal runtime use). */
  diagnostics: ExpansionDiagnostic[];
}

// Re-export for external consumers
export { resolvePath } from "./path-resolver";
export { hasExpandableToken } from "./template/detection";
export { MAX_DEPTH } from "./token-syntax";

/**
 * Expand a text string with diagnostics collection.
 */
export async function expandWithDiagnostics(
  text: string,
  baseDir: string,
  options?: ResolvedMdExpandOptions,
): Promise<ExpandWithDiagnosticsResult> {
  const diagnostics: ExpansionDiagnostic[] = [];
  const logger = options?.debug ? createDebugLogger(options) : undefined;
  const expanded = await expand(text, baseDir, options, {
    visited: new Set(),
    depth: 0,
    readCache: new Map(),
    args: options?.initialArgs ?? EMPTY_ARGS,
    diagnostics,
    options,
    logger,
  });
  return { text: expanded, diagnostics };
}

/**
 * Expand {{arg:key}}, {{env:VAR}}, inline `{{ if=... }}` blocks, and
 * `{{ file="path" }}` templates in `text`.
 *
 * Arg/env substitution is fused into one scanner while preserving arg-first,
 * env-second semantics. Inline conditional substitution then runs synchronously,
 * followed by file substitution (async reads). File content is recursively
 * expanded if it contains further templates, up to MAX_DEPTH levels deep.
 */
export async function expand(
  text: string,
  baseDir: string,
  options?: ResolvedMdExpandOptions,
  ctx?: ExpandContext,
): Promise<string> {
  if (text.indexOf(FILE_TEMPLATE_START) === -1) return text;

  if (!ctx) {
    const logger = options?.debug ? createDebugLogger(options) : undefined;
    ctx = {
      visited: new Set(),
      depth: 0,
      readCache: new Map(),
      args: options?.initialArgs ?? EMPTY_ARGS,
      options,
      logger,
    };
  }

  const scalarInput = text;
  const scalarResult = expandScalarTokens(text, ctx.args, options);
  text = scalarResult.text;
  const protectedRanges = scalarResult.protectedRanges;
  let fileArgRanges = scalarResult.fileArgRanges;
  let hasFile = scalarResult.hasFileTemplate;
  let hasInline = scalarResult.hasInlineConditionalTemplate;

  if (text.indexOf(FILE_TEMPLATE_START) === -1) return stripEmptyExpansionMarkers(text);

  if (text !== scalarInput) {
    if (!hasInline) hasInline = hasInlineConditionalTemplate(text);
    if (!hasFile) hasFile = hasFileTemplate(text);
  }

  if (hasInline) {
    if (!scalarResult.fileArgRangesCollected) {
      fileArgRanges = collectFileArgRanges(text, protectedRanges);
    }
    const inlineProtectedRanges = mergeRanges(protectedRanges, fileArgRanges);
    text = expandInlineConditionals(text, ctx, inlineProtectedRanges, options);
    hasFile = hasFileTemplate(text);
  }

  if (!hasFile) return stripEmptyExpansionMarkers(text);
  // Depth gate: at maxDepth, leave file templates as literal text.
  const maxDepth = options?.maxDepth ?? MAX_DEPTH;
  if (ctx.depth >= maxDepth) return stripEmptyExpansionMarkers(text);
  return stripEmptyExpansionMarkers(
    await expandFileTokens(text, baseDir, ctx, protectedRanges, options),
  );
}

/**
 * Remove lines that consist solely of empty-expansion markers.
 *
 * When a token expands to nothing (e.g., missing file or undefined arg), the
 * marker occupies a line; stripping the whole line avoids blank-line artifacts.
 * Inline markers on non-empty lines are just removed in-place.
 */
function stripEmptyExpansionMarkers(text: string): string {
  if (text.indexOf(EMPTY_EXPANSION_MARKER) === -1) return text;

  let out = "";
  let lineStart = 0;
  while (lineStart < text.length) {
    let lineEnd = lineStart;
    while (lineEnd < text.length) {
      const code = text.charCodeAt(lineEnd);
      if (code === 10 || code === 13) break;
      lineEnd++;
    }

    let nextLine = lineEnd;
    if (nextLine < text.length) {
      if (text.charCodeAt(nextLine) === 13 && text.charCodeAt(nextLine + 1) === 10) {
        nextLine += 2;
      } else {
        nextLine++;
      }
    }

    const line = text.slice(lineStart, lineEnd);
    if (line.indexOf(EMPTY_EXPANSION_MARKER) !== -1) {
      const withoutMarkers = line.split(EMPTY_EXPANSION_MARKER).join("");
      if (withoutMarkers.trim().length !== 0) {
        out += withoutMarkers + text.slice(lineEnd, nextLine);
      }
    } else {
      out += text.slice(lineStart, nextLine);
    }

    lineStart = nextLine;
  }

  return out;
}
