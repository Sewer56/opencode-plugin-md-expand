import type { ResolvedMdExpandOptions } from "./options"
import type { DebugLogger } from "./debug"

/** Shared context for a single expand() call tree: carries cycle guard, read cache, and args. */
export interface ExpandContext {
  /** Resolved absolute paths of ancestor files in the current recursion chain. */
  visited: Set<string>
  depth: number
  /** Raw I/O cache keyed by resolved absolute path (content before recursive expansion). */
  readCache: Map<string, Promise<string>>
  /** Caller-provided args scoped to this expansion level. */
  args: Map<string, string>
  /** Optional diagnostics sink used by validation tooling. Runtime expansion stays silent. */
  diagnostics?: ExpansionDiagnostic[]
  /** Optional resolved options reference for configDirs fallback and logging. */
  options?: ResolvedMdExpandOptions
  /** Optional debug logger. Set by expand() entry points when options.debug is true. */
  logger?: DebugLogger
}

export interface ExpansionDiagnostic {
  kind: "empty-file" | "missing-file" | "read-error" | "cycle"
  token: string
  rawPath?: string
  resolved?: string
  message: string
}

export interface ExpandWithDiagnosticsResult {
  text: string
  diagnostics: ExpansionDiagnostic[]
}

/**
 * Half-open `[start, end)` text span that must not be scanned for tokens.
 */
export interface ProtectedRange {
  start: number
  end: number
}

/**
 * Replacement metadata for one sync token substitution.
 */
export interface ReplacementRange {
  start: number
  end: number
  length: number
}

/** Result of sync token expansion that must preserve protected arg-literal spans. */
export interface SyncExpandResult {
  text: string
  protectedRanges: ProtectedRange[]
}

export interface IfCondition {
  source: "arg" | "env"
  key: string
  expected?: string
}

export interface InlineIfTemplateSpec {
  condition: IfCondition
  /** Inclusive offset of the second `}` in the opening `{{ if=... }}` marker. */
  end: number
}

export interface InlineEndifTemplateSpec {
  /** Inclusive offset of the first `{` in the closing `{{ endif }}` marker. */
  start: number
  /** Inclusive offset of the second `}` in the closing `{{ endif }}` marker. */
  end: number
}

export interface InlineElseTemplateSpec {
  /** Inclusive offset of the first `{` in the `{{ else }}` marker. */
  start: number
  /** Inclusive offset of the second `}` in the `{{ else }}` marker. */
  end: number
}

export interface InlineIfCloseResult {
  /** The `{{ endif }}` that closes the block. */
  endif: InlineEndifTemplateSpec
  /** The `{{ else }}` at the same depth, if present. */
  elseMarker?: InlineElseTemplateSpec
}

export interface FileTemplateSpec {
  rawPath: string
  args: Map<string, string>
  condition?: IfCondition
  /** Inclusive offset of the second `}` in the closing `}}`. */
  end: number
  /** Raw spans for non-file attr values; used only by collectFileArgRanges. */
  argValueRanges?: ProtectedRange[]
}

export interface TemplateValue {
  value: string
  valueStart: number
  valueEnd: number
  next: number
}