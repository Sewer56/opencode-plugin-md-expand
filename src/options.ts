import path from "node:path";

import { MAX_DEPTH } from "./token-syntax";

/**
 * Options accepted by the markdown-expand plugin.
 *
 * @property maxDepth   - Maximum nesting depth for file-template expansion. Defaults to 10.
 * @property debug      - Enable verbose debug logging for template parsing and expansion.
 * @property configDirs - Directories to search for plugin config files. Resolved relative to process.cwd().
 * @property logDir     - Directory for debug logs. Resolved relative to the first configDir, or process.cwd().
 * @property initialArgs - Key-value pairs to inject as `{{arg:*}}` variables. Accepts a plain object or a Map.
 */
export interface MdExpandOptions {
  maxDepth?: number;
  debug?: boolean;
  configDirs?: string[];
  logDir?: string;
  initialArgs?: Record<string, string> | Map<string, string>;
}

/**
 * Fully resolved plugin options after applying defaults and environment overrides.
 *
 * All paths are absolute. All argument maps are normalised to `Map<string, string>`.
 */
export interface ResolvedMdExpandOptions {
  maxDepth: number;
  debug: boolean;
  configDirs: string[];
  logDir: string;
  initialArgs: Map<string, string>;
}

/**
 * Resolve plugin options by merging user input with defaults and applying
 * environment-variable overrides.
 *
 * All paths are resolved to absolute paths before return. `maxDepth` is
 * floored to an integer; negative or non-finite values fall back to `MAX_DEPTH`.
 * Debug mode is active when `debug: true` is set or any of the legacy env vars
 * `FILE_INTERP_DEBUG`, `MD_EXPAND_DEBUG`, or `OPENCODE_PLUGIN_MD_EXPAND_DEBUG`
 * are set to `"1"`.
 *
 * @param options  - User-supplied partial options.
 * @param defaults - Default options to apply before user options (merged first).
 */
export function resolveMdExpandOptions(
  options?: MdExpandOptions | Record<string, unknown>,
  defaults?: MdExpandOptions,
): ResolvedMdExpandOptions {
  const merged = { ...defaults, ...options } as MdExpandOptions;
  const configDirs =
    merged.configDirs && merged.configDirs.length
      ? merged.configDirs.map((p) => path.resolve(p))
      : [];
  // Floor to discard fractional depth values; depth must be a non-negative integer.
  const maxDepth =
    typeof merged.maxDepth === "number" && Number.isFinite(merged.maxDepth) && merged.maxDepth >= 0
      ? Math.floor(merged.maxDepth)
      : MAX_DEPTH;
  // Support three legacy env-var names so existing setups keep working after rename.
  const debug =
    merged.debug === true ||
    process.env.FILE_INTERP_DEBUG === "1" ||
    process.env.MD_EXPAND_DEBUG === "1" ||
    process.env.OPENCODE_PLUGIN_MD_EXPAND_DEBUG === "1";
  // Fall back to configDir[0]/plugins/.logs, then to cwd/.logs when no config dirs exist.
  const logDir =
    typeof merged.logDir === "string" && merged.logDir.length
      ? path.resolve(merged.logDir)
      : configDirs.length
        ? path.join(configDirs[0], "plugins", ".logs", "opencode-plugin-md-expand")
        : path.join(process.cwd(), ".logs", "opencode-plugin-md-expand");
  return {
    maxDepth,
    debug,
    configDirs,
    logDir,
    initialArgs: normalizeArgs(merged.initialArgs),
  };
}

// Normalise initialArgs to a Map<string, string>. Converts plain-object keys to strings.
function normalizeArgs(args: MdExpandOptions["initialArgs"]): Map<string, string> {
  if (!args) return new Map();
  if (args instanceof Map) return new Map(args);
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) out.set(key, String(value));
  return out;
}
