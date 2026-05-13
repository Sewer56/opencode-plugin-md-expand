import fs from "node:fs";
import path from "node:path";

import type { ResolvedMdExpandOptions } from "./options";

export interface DebugLogger {
  log: (...args: unknown[]) => void;
}

/**
 * Creates a debug logger that writes to a log file when debug is enabled.
 * Checks the `debug` flag on resolved options (which already incorporates the
 * `OPENCODE_PLUGIN_MD_EXPAND_DEBUG` env var).
 */
export function createDebugLogger(options: ResolvedMdExpandOptions): DebugLogger {
  const debug = options.debug;

  const logDir = options.logDir;
  const logFile = path.join(logDir, "debug.log");
  let logDirReady = false;

  function log(...args: unknown[]): void {
    if (!debug) return;
    if (!logDirReady) {
      fs.mkdirSync(logDir, { recursive: true });
      logDirReady = true;
    }
    fs.appendFileSync(
      logFile,
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n",
    );
  }

  return { log };
}
