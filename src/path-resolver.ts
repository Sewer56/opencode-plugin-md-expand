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
