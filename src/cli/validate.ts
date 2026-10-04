import fs from "node:fs";
import path from "node:path";

import { defaultConfigDirs } from "../config-discovery";
import { createDebugLogger } from "../debug";
import { expand, hasExpandableToken, type ExpansionDiagnostic } from "../expand";
import { resolveMdExpandOptions, type MdExpandOptions } from "../options";
import { COMMENT_START, stripComments, type CommentErrors } from "../template/comments";

export interface ValidateOptions {
  paths?: string[];
  configDir?: string;
  maxDepth?: number;
  exclude?: string[];
  debug?: boolean;
  cache?: boolean;
  arg?: Record<string, string>;
}

function lineColumn(text: string, index: number): { line: number; column: number } {
  return lineColumns(text, [index])[0];
}

export async function executeValidate(
  paths: string[],
  options: Omit<ValidateOptions, "paths">,
): Promise<number> {
  const configDir = options.configDir ?? process.cwd();

  const mdOptions: MdExpandOptions = {
    configDirs: options.configDir ? [options.configDir] : [],
    maxDepth: options.maxDepth,
    debug: options.debug,
    cache: options.cache,
    initialArgs: options.arg,
  };
  const resolved = resolveMdExpandOptions(mdOptions);
  const effectiveOptions = {
    ...resolved,
    configDirs: resolved.configDirs.length ? resolved.configDirs : defaultConfigDirs(configDir),
  };
  const logger = createDebugLogger(effectiveOptions);
  logger.log(
    `validate: configDir=${configDir} configDirs=${JSON.stringify(effectiveOptions.configDirs)}`,
  );

  const searchPaths = paths.length ? paths : [configDir];
  const exclude = options.exclude ?? [];
  const templateFiles = collectTemplateFiles(searchPaths, exclude);
  logger.log(`validate: found ${templateFiles.length} template file(s)`);

  if (templateFiles.length === 0) {
    console.error("No template files found.");
    return 0;
  }

  let errorCount = 0;
  // Comments already reported, as `path:offset`. Shared files are reported once.
  const reportedComments = new Set<string>();

  for (const file of templateFiles) {
    logger.log(`validate: processing ${file}`);
    let source: string;
    try {
      source = await Bun.file(file).text();
    } catch (err: unknown) {
      console.error(`${file}: cannot read: ${(err as Error).message}`);
      errorCount++;
      continue;
    }

    // Report malformed comments, then validate only the text the model sees.
    const offsets: number[] = [];
    const removed: { start: number; end: number }[] = [];
    const content = stripComments(source, offsets, removed).trim();
    const commentErrors: CommentErrors[] = [];
    if (offsets.length) commentErrors.push({ path: path.resolve(file), text: source, offsets });
    // Source with comments blanked out, so template errors point at their real line.
    const located = blankRanges(source, removed);

    // Expand templates, collecting bad comments from included files too.
    let diagnostics: ExpansionDiagnostic[] = [];
    let remainingFailures: TokenFailure[] = [];
    if (hasExpandableToken(content)) {
      const expanded = await expand(content, configDir, effectiveOptions, {
        visited: new Set(),
        depth: 0,
        readCache: new Map(),
        expandedFileCache: effectiveOptions.cache ? new Map() : undefined,
        args: effectiveOptions.initialArgs,
        diagnostics,
        commentErrors,
        options: effectiveOptions,
        logger: effectiveOptions.debug ? logger : undefined,
      });
      remainingFailures = collectRemainingTokenFailures(expanded);
    } else {
      logger.log(`validate: ${file}: no expandable tokens, skipping`);
    }

    // Print comment errors first, then template errors.
    const commentCount = reportCommentErrors(commentErrors, reportedComments);
    for (const diag of diagnostics) {
      console.log(formatDiagnostic(resolveDiagnostic(file, located, diag)));
    }
    for (const failure of remainingFailures) {
      const failLoc = locateRemaining(file, located, failure);
      if (failLoc) console.log(formatDiagnostic(failLoc));
      else console.log(`${file}: unclosed/malformed token: ${failure.token}`);
    }

    const fileErrors = commentCount + diagnostics.length + remainingFailures.length;
    errorCount += fileErrors;
    if (!fileErrors) logger.log(`validate: ${file}: OK`);
  }

  if (errorCount > 0) {
    console.error(`\n${errorCount} issue(s) found.`);
    return 1;
  } else {
    console.error(`\nAll ${templateFiles.length} template file(s) OK.`);
    return 0;
  }
}

export function collectTemplateFiles(paths: string[], exclude: string[] = []): string[] {
  const files: string[] = [];
  for (const p of paths) {
    collectTemplateFilesFrom(p, files, exclude);
  }
  return [...new Set(files)].sort();
}

export function collectTemplateFilesFrom(
  dirOrFile: string,
  into: string[],
  exclude: string[] = [],
): void {
  const stat = fs.statSync(dirOrFile);
  if (stat.isFile()) {
    if (isTemplateFile(dirOrFile) && !isExcluded(dirOrFile, exclude)) into.push(dirOrFile);
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(dirOrFile)) {
      const full = path.join(dirOrFile, entry);
      if (!isExcluded(full, exclude)) collectTemplateFilesFrom(full, into, exclude);
    }
  }
}

/** Check if `filePath` matches any exclude pattern. Matches against the full path or any trailing segment. */
function isExcluded(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (
      filePath === pattern ||
      filePath.endsWith("/" + pattern) ||
      filePath.endsWith("\\" + pattern)
    )
      return true;
  }
  return false;
}

export function isTemplateFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".txt" || ext === ".mdc" || ext === ".opencode";
}

interface LocatedDiagnostic {
  file: string;
  line: number;
  column: number;
  kind: string;
  token: string;
  message: string;
  rawPath?: string;
}

interface TokenFailure {
  token: string;
  index: number;
}

function resolveDiagnostic(
  file: string,
  content: string,
  diag: { token: string; message: string; rawPath?: string; resolved?: string },
): LocatedDiagnostic {
  const kind = diag.token.includes("file")
    ? diag.token.includes("empty-file")
      ? "empty-file"
      : diag.token.includes("cycle")
        ? "cycle"
        : diag.token.includes("missing")
          ? "missing-file"
          : "read-error"
    : "malformed";
  const index = content.indexOf(diag.token);
  const { line, column } = index >= 0 ? lineColumn(content, index) : { line: 0, column: 0 };
  return {
    file,
    line,
    column,
    kind,
    token: diag.token,
    message: diag.message,
    rawPath: diag.rawPath,
  };
}

function formatDiagnostic(loc: LocatedDiagnostic): string {
  let out = `${loc.file}:${loc.line}:${loc.column}: ${loc.kind}`;
  if (loc.token && loc.token.length < 80) out += ` ${loc.token}`;
  out += `: ${loc.message}`;
  if (loc.rawPath) out += ` (path: ${loc.rawPath})`;
  return out;
}

function collectRemainingTokenFailures(text: string): TokenFailure[] {
  const failures: TokenFailure[] = [];
  let searchFrom = 0;
  while (true) {
    const start = text.indexOf("{{", searchFrom);
    if (start === -1) break;
    const end = text.indexOf("}}", start);
    if (end === -1) {
      failures.push({
        token: text.slice(start, start + Math.min(60, text.length - start)),
        index: start,
      });
      searchFrom = start + 2;
      continue;
    }
    // Check if it's an unclosed if/endif
    const inner = text.slice(start, end + 2);
    if (inner.includes("if=") && !inner.includes("endif")) {
      failures.push({ token: inner, index: start });
    }
    if (inner === "{{ endif }}" || inner === "{{ else }}") {
      // These are fine, skip
    }
    searchFrom = end + 2;
  }
  return failures;
}

/**
 * Print each malformed comment not yet reported and return how many were printed.
 *
 * @param errors   - Malformed comments grouped by file, offsets ascending.
 * @param reported - `path:offset` keys already printed; updated in place.
 */
function reportCommentErrors(errors: CommentErrors[], reported: Set<string>): number {
  let count = 0;
  for (const { path: file, text, offsets } of errors) {
    const fresh = offsets.filter((offset) => !reported.has(`${file}:${offset}`));
    const locations = lineColumns(text, fresh);
    for (let i = 0; i < fresh.length; i++) {
      reported.add(`${file}:${fresh[i]}`);
      console.log(
        formatDiagnostic({
          file,
          ...locations[i],
          kind: "malformed-comment",
          token: COMMENT_START,
          message: "comment needs a closing ---> at the end of a line",
        }),
      );
    }
    count += fresh.length;
  }
  return count;
}

/**
 * Replace each range with spaces, keeping line breaks.
 * Offsets and line numbers then still match the original text.
 */
function blankRanges(text: string, ranges: { start: number; end: number }[]): string {
  if (!ranges.length) return text;
  let out = "";
  let cursor = 0;
  for (const { start, end } of ranges) {
    out += text.slice(cursor, start) + text.slice(start, end).replace(/[^\r\n]/g, " ");
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** Return line and column numbers for ascending offsets in one pass. */
function lineColumns(text: string, offsets: number[]): { line: number; column: number }[] {
  const out: { line: number; column: number }[] = [];
  let line = 1;
  let lineStart = 0;
  let i = 0;
  for (const offset of offsets) {
    for (; i < offset; i++) {
      const code = text.charCodeAt(i);
      if (code !== 10 && code !== 13) continue;
      if (code === 13 && text.charCodeAt(i + 1) === 10) i++;
      line++;
      lineStart = i + 1;
    }
    out.push({ line, column: offset - lineStart + 1 });
  }
  return out;
}

function locateRemaining(
  file: string,
  content: string,
  failure: TokenFailure,
): LocatedDiagnostic | undefined {
  // `failure.index` points into expanded text, so find the token's first line in the source.
  // Give up when it is missing or appears more than once.
  const newline = failure.token.indexOf("\n");
  const opener = newline === -1 ? failure.token : failure.token.slice(0, newline);
  const found = content.indexOf(opener);
  if (found === -1 || content.indexOf(opener, found + 1) !== -1) return undefined;
  const { line, column } = lineColumn(content, found);
  return {
    file,
    line,
    column,
    kind: "malformed",
    token: failure.token,
    message: "unclosed or malformed token",
  };
}
