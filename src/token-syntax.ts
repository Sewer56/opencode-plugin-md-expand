import type { ProtectedRange } from "./types";

/** Token prefixes. Keep exact: no plain `$VAR`, `%VAR%`, or bare names. */
export const TOKEN_START = "{";
export const FILE_TEMPLATE_START = "{{";
export const FILE_TEMPLATE_END = "}}";
export const FILE_ATTR = "file";
export const IF_ATTR = "if";
export const ENDIF_ATTR = "endif";
export const ENV_CONDITION_PREFIX = "env:";
export const ENV_PREFIX = "{{env:";
export const ARG_PREFIX = "{{arg:";
export const TOKEN_END = "}}";

/** Maximum recursion depth for nested file-template expansion. Exported for tests. */
export const MAX_DEPTH = 10;

/** Internal marker for empty token expansions; removed after line-aware cleanup. */
export const EMPTY_EXPANSION_MARKER = "\uE000FILE_INTERP_EMPTY\uE001";

/** Shared immutable empty maps/ranges to avoid hot-path allocations. Never mutate. */
export const EMPTY_ARGS = new Map<string, string>();
export const EMPTY_RANGES: ProtectedRange[] = [];
