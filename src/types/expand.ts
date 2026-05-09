import type { DebugLogger } from "../debug";
import type { ResolvedMdExpandOptions } from "../options";

/**
 * Diagnostic record for a single expansion issue encountered during template processing.
 */
export interface ExpansionDiagnostic {
  /** Diagnostic category indicating the type of issue encountered. */
  kind: "empty-file" | "missing-file" | "read-error" | "cycle";
  /** The full template token string that triggered the diagnostic. */
  token: string;
  /** Original path as written in the template, before resolution. */
  rawPath?: string;
  /** Resolved absolute path if path resolution was attempted. */
  resolved?: string;
  /** Human-readable error message describing the issue. */
  message: string;
}

/**
 * Shared execution context for a single expand() call tree.
 * Carries cycle detection state, read cache, and argument bindings through recursive expansion.
 */
export interface ExpandContext {
  /** Resolved absolute paths of ancestor files in the current recursion chain. */
  visited: Set<string>;
  /** Current recursion depth. Starts at 0 for the root expand() call. */
  depth: number;
  /** Raw I/O cache keyed by resolved absolute path (content before recursive expansion). */
  readCache: Map<string, Promise<string>>;
  /** Caller-provided args scoped to this expansion level. */
  args: Map<string, string>;
  /** Optional diagnostics sink used by validation tooling. Runtime expansion stays silent. */
  diagnostics?: ExpansionDiagnostic[];
  /** Optional resolved options reference for configDirs fallback and logging. */
  options?: ResolvedMdExpandOptions;
  /** Optional debug logger. Set by expand() entry points when options.debug is true. */
  logger?: DebugLogger;
}

/**
 * Result of expandWithDiagnostics() containing expanded text and any issues encountered.
 */
export interface ExpandWithDiagnosticsResult {
  /** The fully expanded template text with all tokens substituted. */
  text: string;
  /** Collection of diagnostics encountered during expansion (empty in normal runtime use). */
  diagnostics: ExpansionDiagnostic[];
}
