import fs from "node:fs"
import path from "node:path"
import { parseCommonArgs, resolveInputPath, lineColumn, type CliDefaults } from "./shared"
import { resolveMdExpandOptions } from "../options"
import { expandWithDiagnostics, hasExpandableToken } from "../expand"
import { createDebugLogger } from "../debug"
import { defaultConfigDirs } from "../config-discovery"

export async function runValidateCli(args: string[], defaults?: CliDefaults): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printValidateHelp(defaults?.programName ?? "opencode-plugin-md-expand validate")
    return 0
  }

  const parsed = parseCommonArgs(args, defaults)
  const { configDir, options: rawOptions, positional } = parsed

  const resolved = resolveMdExpandOptions(rawOptions)
  const effectiveOptions = {
    ...resolved,
    configDirs: resolved.configDirs.length
      ? resolved.configDirs
      : defaultConfigDirs(configDir),
  }
  const logger = createDebugLogger(effectiveOptions)
  logger.log(`validate: configDir=${configDir} configDirs=${JSON.stringify(effectiveOptions.configDirs)}`)

  const searchPaths = positional.length ? positional : [configDir]
  const templateFiles = collectTemplateFiles(searchPaths)
  logger.log(`validate: found ${templateFiles.length} template file(s)`)

  if (templateFiles.length === 0) {
    console.error("No template files found.")
    return 0
  }

  let errorCount = 0

  for (const file of templateFiles) {
    logger.log(`validate: processing ${file}`)
    let content: string
    try {
      content = (await Bun.file(file).text()).trim()
    } catch (err: unknown) {
      console.error(`${file}: cannot read: ${(err as Error).message}`)
      errorCount++
      continue
    }

    if (!hasExpandableToken(content)) {
      logger.log(`validate: ${file}: no expandable tokens, skipping`)
      continue
    }

    const result = await expandWithDiagnostics(content, configDir, effectiveOptions)
    const remainingFailures = collectRemainingTokenFailures(result.text)

    if (result.diagnostics.length > 0 || remainingFailures.length > 0) {
      for (const diag of result.diagnostics) {
        const diagLoc = resolveDiagnostic(file, content, diag)
        console.log(formatDiagnostic(diagLoc))
      }
      for (const failure of remainingFailures) {
        const failLoc = locateRemaining(file, content, failure)
        if (failLoc) console.log(formatDiagnostic(failLoc))
        else console.log(`${file}: unclosed/malformed token: ${failure.token}`)
      }
      errorCount += result.diagnostics.length + remainingFailures.length
    } else {
      logger.log(`validate: ${file}: OK`)
    }
  }

  if (errorCount > 0) {
    console.error(`\n${errorCount} issue(s) found.`)
    return 1
  } else {
    console.error(`\nAll ${templateFiles.length} template file(s) OK.`)
    return 0
  }
}

export function printValidateHelp(program?: string): void {
  const p = program ?? "opencode-plugin-md-expand validate"
  console.log(`${p}: Validate template files

Usage:
  ${p} [options] [paths...]

Options:
  --config-dir <path>   Config directory for relative includes (default: auto-discover)
  --max-depth <n>        Maximum recursive file include depth (default: 10)
  --debug                Write debug log
  --arg key=value        Initial arg for top-level expansion; repeatable
  --help, -h             Show this help

If no paths are given, the config directory is scanned for template files.
`)
}

interface TemplateFile {
  path: string
  content: string
}

interface LocatedDiagnostic {
  file: string
  line: number
  column: number
  kind: string
  token: string
  message: string
  rawPath?: string
}

export function collectTemplateFiles(paths: string[]): string[] {
  const files: string[] = []
  for (const p of paths) {
    collectTemplateFilesFrom(p, files)
  }
  return [...new Set(files)].sort()
}

export function collectTemplateFilesFrom(dirOrFile: string, into: string[]): void {
  const stat = fs.statSync(dirOrFile)
  if (stat.isFile()) {
    if (isTemplateFile(dirOrFile)) into.push(dirOrFile)
    return
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(dirOrFile)) {
      const full = path.join(dirOrFile, entry)
      collectTemplateFilesFrom(full, into)
    }
  }
}

export function isTemplateFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === ".md" || ext === ".txt" || ext === ".mdc" || ext === ".opencode"
}

function resolveDiagnostic(
  file: string,
  content: string,
  diag: { token: string; message: string; rawPath?: string; resolved?: string },
): LocatedDiagnostic {
  const kind = diag.token.includes("file") ? diag.token.includes("empty-file") ? "empty-file"
    : diag.token.includes("cycle") ? "cycle"
    : diag.token.includes("missing") ? "missing-file"
    : "read-error" : "malformed"
  const index = content.indexOf(diag.token)
  const { line, column } = index >= 0 ? lineColumn(content, index) : { line: 0, column: 0 }
  return {
    file,
    line,
    column,
    kind,
    token: diag.token,
    message: diag.message,
    rawPath: diag.rawPath,
  }
}

function formatDiagnostic(loc: LocatedDiagnostic): string {
  let out = `${loc.file}:${loc.line}:${loc.column}: ${loc.kind}`
  if (loc.token && loc.token.length < 80) out += ` ${loc.token}`
  out += `: ${loc.message}`
  if (loc.rawPath) out += ` (path: ${loc.rawPath})`
  return out
}

interface TokenFailure {
  token: string
  index: number
}

function collectRemainingTokenFailures(text: string): TokenFailure[] {
  const failures: TokenFailure[] = []
  let searchFrom = 0
  while (true) {
    const start = text.indexOf("{{", searchFrom)
    if (start === -1) break
    const end = text.indexOf("}}", start)
    if (end === -1) {
      failures.push({ token: text.slice(start, start + Math.min(60, text.length - start)), index: start })
      searchFrom = start + 2
      continue
    }
    // Check if it's an unclosed if/endif
    const inner = text.slice(start, end + 2)
    if (inner.includes("if=") && !inner.includes("endif")) {
      failures.push({ token: inner, index: start })
    }
    if (inner === "{{ endif }}" || inner === "{{ else }}") {
      // These are fine, skip
    }
    searchFrom = end + 2
  }
  return failures
}

function locateRemaining(
  file: string,
  content: string,
  failure: TokenFailure,
): LocatedDiagnostic | undefined {
  const { line, column } = lineColumn(content, failure.index)
  return {
    file,
    line,
    column,
    kind: "malformed",
    token: failure.token,
    message: "unclosed or malformed token",
  }
}