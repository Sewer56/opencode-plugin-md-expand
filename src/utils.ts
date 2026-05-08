import path from "node:path"
import os from "node:os"

const HOME_DIR = os.homedir()

/**
 * Resolve a raw token path to an absolute filesystem path.
 *
 * - `~/...`  → `$HOME/...`
 * - `./...`  → relative to `baseDir`
 * - `../...` → relative to `baseDir`
 * - other    → used as-is (assumed absolute)
 */
export function resolvePath(raw: string, baseDir: string): string {
  if (raw.startsWith("~/") || raw === "~") {
    return path.join(HOME_DIR, raw.slice(1))
  }
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return path.resolve(baseDir, raw)
  }
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw)
}

export function formatArgsForCall(args: Map<string, string>): string {
  let out = ""
  for (const [key, value] of args) {
    if (out) out += " "
    out += `${key}=${value}`
  }
  return out
}

export function formatArgsForLog(args: Map<string, string>): string {
  let out = ""
  for (const [key, value] of args) {
    if (out) out += ", "
    out += `${key}=${value}`
  }
  return out
}

import { EMPTY_EXPANSION_MARKER } from "./constants.js"

export function stripEmptyExpansionMarkers(text: string): string {
  if (text.indexOf(EMPTY_EXPANSION_MARKER) === -1) return text

  let out = ""
  let lineStart = 0
  while (lineStart < text.length) {
    let lineEnd = lineStart
    while (lineEnd < text.length) {
      const code = text.charCodeAt(lineEnd)
      if (code === 10 || code === 13) break
      lineEnd++
    }

    let nextLine = lineEnd
    if (nextLine < text.length) {
      if (text.charCodeAt(nextLine) === 13 && text.charCodeAt(nextLine + 1) === 10) {
        nextLine += 2
      } else {
        nextLine++
      }
    }

    const line = text.slice(lineStart, lineEnd)
    if (line.indexOf(EMPTY_EXPANSION_MARKER) !== -1) {
      const withoutMarkers = line.split(EMPTY_EXPANSION_MARKER).join("")
      if (withoutMarkers.trim().length !== 0) {
        out += withoutMarkers + text.slice(lineEnd, nextLine)
      }
    } else {
      out += text.slice(lineStart, nextLine)
    }

    lineStart = nextLine
  }

  return out
}
