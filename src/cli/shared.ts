import path from "node:path"
import type { MdExpandOptions } from "../options"

export interface CliDefaults {
  defaultConfigDir?: string
  programName?: string
}

export interface ParsedCommon {
  configDir: string
  options: MdExpandOptions
  positional: string[]
}

export function parseCommonArgs(args: string[], defaults: CliDefaults = {}): ParsedCommon {
  const positional: string[] = []
  const initialArgs: Record<string, string> = {}
  let configDir = defaults.defaultConfigDir
    ? path.resolve(defaults.defaultConfigDir)
    : process.env.OPENCODE_CONFIG_DIR
      ? path.resolve(process.env.OPENCODE_CONFIG_DIR)
      : process.cwd()
  let maxDepth: number | undefined
  let debug = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--config-dir") {
      if (!args[i + 1]) throw new Error("--config-dir requires a value")
      configDir = path.resolve(process.cwd(), args[++i])
      continue
    }
    if (arg === "--max-depth") {
      if (!args[i + 1]) throw new Error("--max-depth requires a value")
      maxDepth = Number(args[++i])
      if (!Number.isFinite(maxDepth) || maxDepth < 0) throw new Error("--max-depth must be a non-negative number")
      continue
    }
    if (arg === "--debug") {
      debug = true
      continue
    }
    if (arg === "--arg") {
      if (!args[i + 1]) throw new Error("--arg requires key=value")
      const next = args[++i]
      const eq = next.indexOf("=")
      if (eq <= 0) throw new Error("--arg requires key=value")
      initialArgs[next.slice(0, eq)] = next.slice(eq + 1)
      continue
    }
    if (arg === "--") {
      positional.push(...args.slice(i + 1))
      break
    }
    positional.push(arg)
  }

  return {
    configDir,
    options: {
      configDirs: [configDir],
      maxDepth,
      debug,
      initialArgs,
    },
    positional,
  }
}

export function lineColumn(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < index; i++) {
    const code = text.charCodeAt(i)
    if (code !== 10 && code !== 13) continue
    if (code === 13 && text.charCodeAt(i + 1) === 10) i++
    line++
    lineStart = i + 1
  }
  return { line, column: index - lineStart + 1 }
}

export function resolveInputPath(input: string, configDir: string): string {
  if (path.isAbsolute(input)) return input
  return path.resolve(configDir, input)
}