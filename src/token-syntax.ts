import type { ProtectedRange } from "./types/ranges";

// ════════════════════════════════════════════════════════════════════════════════
//  Token delimiters
// ════════════════════════════════════════════════════════════════════════════════

export const TOKEN_START = "{";
export const TOKEN_END = "}}";

export const FILE_TEMPLATE_START = "{{";
export const FILE_TEMPLATE_END = "}}";

// ════════════════════════════════════════════════════════════════════════════════
//  Token attribute names
//  e.g. {{ file="path" }}, {{ if=... }}, {{ endif }}
// ════════════════════════════════════════════════════════════════════════════════

export const FILE_ATTR = "file";
export const IF_ATTR = "if";
export const ENDIF_ATTR = "endif";

// ════════════════════════════════════════════════════════════════════════════════
//  Prefix patterns — keep exact: no plain `$VAR`, `%VAR%`, or bare names
// ════════════════════════════════════════════════════════════════════════════════

export const ENV_CONDITION_PREFIX = "env:";
export const ENV_PREFIX = "{{env:";
export const ARG_PREFIX = "{{arg:";

// ════════════════════════════════════════════════════════════════════════════════
//  Configuration
// ════════════════════════════════════════════════════════════════════════════════

/** Maximum recursion depth for nested file-template expansion. Exported for tests. */
export const MAX_DEPTH = 10;

// ════════════════════════════════════════════════════════════════════════════════
//  Internal markers
// ════════════════════════════════════════════════════════════════════════════════

/** Internal marker for empty token expansions; removed after line-aware cleanup. */
export const EMPTY_EXPANSION_MARKER = "\uE000FILE_INTERP_EMPTY\uE001";

// ════════════════════════════════════════════════════════════════════════════════
//  Shared immutable objects — never mutate
// ════════════════════════════════════════════════════════════════════════════════

/** Shared immutable empty map to avoid hot-path allocations. */
export const EMPTY_ARGS = new Map<string, string>();

/** Shared immutable empty range array to avoid hot-path allocations. */
export const EMPTY_RANGES: ProtectedRange[] = [];
