import { createDebugLogger } from "./debug";
import type { ResolvedMdExpandOptions } from "./options";
import { mergeRanges } from "./ranges";
import { hasExpandableToken } from "./template/detection";
import { collectFileArgRanges } from "./template/file-parser";
import {
  MAX_DEPTH,
  TOKEN_START,
  ARG_PREFIX,
  ENV_PREFIX,
  FILE_TEMPLATE_START,
  EMPTY_ARGS,
  EMPTY_EXPANSION_MARKER,
  EMPTY_RANGES,
} from "./token-syntax";
import { expandArgTokens } from "./tokens/arg";
import { expandInlineConditionals } from "./tokens/conditional";
import { expandEnvTokens } from "./tokens/env";
import { expandFileTokens } from "./tokens/file";
import type { ExpandContext, ExpansionDiagnostic, ExpandWithDiagnosticsResult } from "./types";

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
 * Arg substitution runs first (synchronous), then environment substitution
 * (synchronous), then inline conditional substitution (synchronous), then file
 * substitution (async reads). File content is recursively expanded if it contains
 * further templates, up to MAX_DEPTH levels deep.
 */
export async function expand(
  text: string,
  baseDir: string,
  options?: ResolvedMdExpandOptions,
  ctx?: ExpandContext,
): Promise<string> {
  if (text.indexOf(TOKEN_START) === -1) return text;

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

  const hasArg = text.includes(ARG_PREFIX);
  const hasEnv = text.includes(ENV_PREFIX);
  const hasTemplate = text.includes(FILE_TEMPLATE_START);
  let hasFile = hasTemplate;
  if (!hasArg && !hasEnv && !hasTemplate) return text;

  let protectedRanges = EMPTY_RANGES;

  if (hasArg) {
    const argResult = expandArgTokens(text, ctx.args, options);
    text = argResult.text;
    protectedRanges = argResult.protectedRanges;
  }

  if (hasEnv) {
    const envResult = expandEnvTokens(text, protectedRanges, options);
    text = envResult.text;
    protectedRanges = envResult.protectedRanges;
  }

  if (hasTemplate) {
    const inlineProtectedRanges = mergeRanges(
      protectedRanges,
      collectFileArgRanges(text, protectedRanges),
    );
    text = expandInlineConditionals(text, ctx, inlineProtectedRanges, options);
  }

  if (!hasFile) hasFile = text.includes(FILE_TEMPLATE_START);
  if (!hasFile) return stripEmptyExpansionMarkers(text);
  // Depth gate: at maxDepth, leave file templates as literal text.
  const maxDepth = options?.maxDepth ?? MAX_DEPTH;
  if (ctx.depth >= maxDepth) return stripEmptyExpansionMarkers(text);
  return stripEmptyExpansionMarkers(
    await expandFileTokens(text, baseDir, ctx, protectedRanges, options),
  );
}

function recordDiagnostic(ctx: ExpandContext, diagnostic: ExpansionDiagnostic): void {
  ctx.diagnostics?.push(diagnostic);
  ctx.logger?.log(`diagnostic: ${diagnostic.kind} ${diagnostic.token} ${diagnostic.message}`);
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
