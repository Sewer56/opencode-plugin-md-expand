import path from "node:path";

import { createDebugLogger } from "../debug";
import { expand } from "../expand";
import type { ResolvedMdExpandOptions } from "../options";
import { resolvePath } from "../path-resolver";
import { advanceRangeIndex, isInRange } from "../ranges";
import { shouldExpandForCondition } from "../template/conditions";
import { hasExpandableToken } from "../template/detection";
import { parseFileTemplate } from "../template/file-parser";
import { FILE_TEMPLATE_START, EMPTY_ARGS, EMPTY_EXPANSION_MARKER } from "../token-syntax";
import type { ExpandContext, ProtectedRange } from "../types";

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
 * Expand `{{ file="path" }}` templates.
 */
export async function expandFileTokens(
  text: string,
  baseDir: string,
  ctx: ExpandContext,
  protectedRanges: ProtectedRange[],
  options?: ResolvedMdExpandOptions,
): Promise<string> {
  const logger = options ? createDebugLogger(options) : undefined;
  const parts: string[] = [];
  const reads: Promise<string>[] = [];

  let cursor = 0;
  let searchFrom = 0;
  let protectedIndex = 0;

  while (true) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom);
    if (start === -1) break;

    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start);
    if (isInRange(protectedRanges, protectedIndex, start)) {
      searchFrom = protectedRanges[protectedIndex].end;
      continue;
    }

    const parsed = parseFileTemplate(text, start, protectedRanges);
    if (!parsed) {
      searchFrom = start + FILE_TEMPLATE_START.length;
      continue;
    }

    const { rawPath, args, condition, end } = parsed;
    const token = logger || ctx.diagnostics ? text.slice(start, end + 1) : "";

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

    let rawPromise = ctx.readCache.get(resolved);
    if (!rawPromise) {
      rawPromise = readRawFile(resolved, rawPath, token, ctx, options);
      ctx.readCache.set(resolved, rawPromise);
    }

    const read = rawPromise.then((raw) =>
      recursivelyExpand(raw, resolved, baseDir, token, ctx, args, options),
    );

    parts.push(text.slice(cursor, start));
    reads.push(read);
    cursor = end + 1;
    searchFrom = cursor;
  }

  if (!reads.length) return text;

  const tail = text.slice(cursor);

  const stripTrailingNewline = (s: string): string => {
    if (s.endsWith("\r\n")) return s.slice(0, -2);
    if (s.endsWith("\n")) return s.slice(0, -1);
    return s;
  };

  if (reads.length === 1) {
    return parts[0] + stripTrailingNewline(await reads[0]) + tail;
  }

  const contents = await Promise.all(reads);
  let out = "";
  for (let i = 0; i < contents.length; i++) {
    out += parts[i] + stripTrailingNewline(contents[i]);
  }
  return out + tail;
}

/**
 * Read raw file content (trimmed), with multi-configDir fallback for relative paths.
 */
async function readRawFile(
  resolved: string,
  rawPath: string,
  token: string,
  ctx: ExpandContext,
  options?: ResolvedMdExpandOptions,
): Promise<string> {
  const logger = options ? createDebugLogger(options) : undefined;

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

    for (const configDir of configDirs) {
      const configResolved = path.resolve(configDir, rawPath);
      if (configResolved === resolved) continue;
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
        // ENOENT: try next fallback
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
 * Recursively expand tokens in raw file content if depth allows and tokens exist.
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
  const logger = options ? createDebugLogger(options) : undefined;
  if (!hasExpandableToken(raw)) return raw;
  const childVisited = new Set(ctx.visited);
  childVisited.add(resolved);
  const expanded = await expand(raw, baseDir, options, {
    visited: childVisited,
    depth: ctx.depth + 1,
    readCache: ctx.readCache,
    args,
    diagnostics: ctx.diagnostics,
  });
  logger?.log(
    `file: ${token} → ${resolved} recursive expansion (${expanded.length} chars, depth ${ctx.depth + 1})`,
  );
  return expanded;
}
