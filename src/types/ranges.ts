/**
 * Half-open `[start, end)` text span that must not be scanned for tokens.
 * Used to protect arg-literal values and other regions from token expansion.
 */
export interface ProtectedRange {
  /** Start offset (inclusive) in the source text. */
  start: number;
  /** End offset (exclusive) in the source text. */
  end: number;
}

/**
 * Replacement metadata for one sync token substitution.
 * Tracks the span being replaced and the length of the replacement content.
 */
export interface ReplacementRange {
  /** Start offset (inclusive) of the token being replaced. */
  start: number;
  /** End offset (exclusive) of the token being replaced. */
  end: number;
  /** Length of the replacement text that will be inserted. */
  length: number;
}

/**
 * Result of synchronous token expansion (env/arg tokens).
 * Includes protected ranges that must be preserved during subsequent expansion passes.
 */
export interface SyncExpandResult {
  /** The expanded text with tokens substituted. */
  text: string;
  /** Accumulated protected ranges including any new arg-literal spans created during expansion. */
  protectedRanges: ProtectedRange[];
}
