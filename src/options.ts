import path from "node:path";

import { MAX_DEPTH } from "./token-syntax";

/**
 * Options accepted by the markdown-expand plugin.
 *
 * @property maxDepth        - Maximum nesting depth for file-template expansion. Defaults to 10.
 * @property debug           - Enable verbose debug logging for template parsing and expansion.
 * @property configDirs      - Directories to search for plugin config files. When set, replaces the
 *                             default dirs entirely. Resolved relative to process.cwd().
 * @property extraConfigDirs - Additional directories appended to the default config dirs. Ignored when
 *                             `configDirs` is also set (override takes precedence). Resolved relative
 *                             to process.cwd(). Useful in `opencode.json` where dynamic defaults
 *                             (project root, cwd) cannot be expressed as static paths.
 * @property logDir          - Directory for debug logs. Resolved relative to the first configDir, or process.cwd().
 * @property initialArgs     - Key-value pairs to inject as `{{arg:*}}` variables. Accepts a plain object or a Map.
 */
export interface MdExpandOptions {
  maxDepth?: number;
  debug?: boolean;
  configDirs?: string[];
  extraConfigDirs?: string[];
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
  extraConfigDirs: string[];
  logDir: string;
  initialArgs: Map<string, string>;
}

/**
 * Resolve plugin options by merging user input with defaults and applying
 * environment-variable overrides.
 *
 * All paths are resolved to absolute paths before return. `maxDepth` is
 * floored to an integer; negative or non-finite values fall back to `MAX_DEPTH`.
 * Debug mode is active when `debug: true` is set or the env var
 * `OPENCODE_PLUGIN_MD_EXPAND_DEBUG` is set to `"1"`.
 *
 * @param options  - User-supplied partial options.
 * @param defaults - Default options to apply before user options (merged first).
 */
export function resolveMdExpandOptions(
  options?: MdExpandOptions | Record<string, unknown>,
  defaults?: MdExpandOptions,
): ResolvedMdExpandOptions {
  const merged = { ...defaults, ...options } as MdExpandOptions;
  const configDirs = merged.configDirs?.length ? merged.configDirs.map((p) => path.resolve(p)) : [];
  const extraConfigDirs = merged.extraConfigDirs?.length
    ? merged.extraConfigDirs.map((p) => path.resolve(p))
    : [];
  const maxDepth = isValidMaxDepth(merged.maxDepth) ? Math.floor(merged.maxDepth) : MAX_DEPTH;
  const debug = merged.debug === true || isDebugEnv();
  const logDir = resolveLogDir(merged.logDir, configDirs);

  return {
    maxDepth,
    debug,
    configDirs,
    extraConfigDirs,
    logDir,
    initialArgs: normalizeArgs(merged.initialArgs),
  };
}

/** True when `value` is a finite non-negative number (valid maxDepth). */
function isValidMaxDepth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** True when the debug env var `OPENCODE_PLUGIN_MD_EXPAND_DEBUG` is set to `"1"`. */
function isDebugEnv(): boolean {
  return process.env.OPENCODE_PLUGIN_MD_EXPAND_DEBUG === "1";
}

/** Resolve log directory: explicit path > first configDir/plugins/.logs > cwd/.logs. */
function resolveLogDir(logDir: string | undefined, configDirs: string[]): string {
  if (typeof logDir === "string" && logDir.length) return path.resolve(logDir);
  if (configDirs.length)
    return path.join(configDirs[0], "plugins", ".logs", "opencode-plugin-md-expand");
  return path.join(process.cwd(), ".logs", "opencode-plugin-md-expand");
}

/** Normalise initialArgs to a Map<string, string>. Converts plain-object keys to strings. */
function normalizeArgs(args: MdExpandOptions["initialArgs"]): Map<string, string> {
  if (!args) return new Map();
  if (args instanceof Map) return new Map(args);
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) out.set(key, String(value));
  return out;
}
