import path from "node:path";

import { MAX_DEPTH } from "./token-syntax";

export interface MdExpandOptions {
  maxDepth?: number;
  debug?: boolean;
  configDirs?: string[];
  logDir?: string;
  initialArgs?: Record<string, string> | Map<string, string>;
}

export interface ResolvedMdExpandOptions {
  maxDepth: number;
  debug: boolean;
  configDirs: string[];
  logDir: string;
  initialArgs: Map<string, string>;
}

export function resolveMdExpandOptions(
  options?: MdExpandOptions | Record<string, unknown>,
  defaults?: MdExpandOptions,
): ResolvedMdExpandOptions {
  const merged = { ...defaults, ...options } as MdExpandOptions;
  const configDirs =
    merged.configDirs && merged.configDirs.length
      ? merged.configDirs.map((p) => path.resolve(p))
      : [];
  const maxDepth =
    typeof merged.maxDepth === "number" && Number.isFinite(merged.maxDepth) && merged.maxDepth >= 0
      ? Math.floor(merged.maxDepth)
      : MAX_DEPTH;
  const debug =
    merged.debug === true ||
    process.env.FILE_INTERP_DEBUG === "1" ||
    process.env.MD_EXPAND_DEBUG === "1" ||
    process.env.OPENCODE_PLUGIN_MD_EXPAND_DEBUG === "1";
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

function normalizeArgs(args: MdExpandOptions["initialArgs"]): Map<string, string> {
  if (!args) return new Map();
  if (args instanceof Map) return new Map(args);
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) out.set(key, String(value));
  return out;
}
