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
 * Advance a range cursor past ranges that end at or before `pos`.
 *
 * Used together with {@link isInRange} to maintain a monotonic cursor while
 * scanning text left-to-right: advance the cursor first, then test membership.
 *
 * @param ranges - Sorted list of protected ranges (by `start` ascending).
 * @param index - Current cursor position in `ranges` (may equal `ranges.length`).
 * @param pos - Source-text offset to advance past.
 * @returns The smallest `index` such that `ranges[index].end > pos`, or
 *   `ranges.length` if no such range exists.
 */
export function advanceRangeIndex(ranges: ProtectedRange[], index: number, pos: number): number {
  // Skip ranges ending at or before `pos`; they cannot contain `pos`.
  while (index < ranges.length && ranges[index].end <= pos) index++;
  return index;
}

/**
 * Check whether `pos` falls inside the range at `ranges[index]`.
 *
 * Intended to be called after {@link advanceRangeIndex} so that `index`
 * points to the first range not entirely before `pos`. If `index` is out
 * of bounds, returns `false`.
 *
 * @param ranges - Sorted list of protected ranges.
 * @param index - Cursor position in `ranges` (may equal `ranges.length`).
 * @param pos - Source-text offset to test.
 * @returns `true` when `pos` is inside `ranges[index]`'s half-open span.
 */
export function isInRange(ranges: ProtectedRange[], index: number, pos: number): boolean {
  const range = ranges[index];
  // Half-open check: start inclusive, end exclusive.
  return range !== undefined && pos >= range.start && pos < range.end;
}

/**
 * Adjust protected/file-arg range offsets after text replacements shift positions.
 *
 * Walks sorted ranges alongside sorted replacements, accumulating a running
 * delta (replacement length minus replaced span length) and shifting each range
 * by the cumulative delta of all replacements that end before the range starts.
 * Assumes replacements and ranges are both sorted by start offset ascending.
 */
export function remapRanges(
  ranges: ProtectedRange[],
  replacements: ReplacementRange[],
): ProtectedRange[] {
  if (!ranges.length || !replacements.length) return ranges;

  const out: ProtectedRange[] = [];
  let replacementIndex = 0;
  let delta = 0;
  for (const range of ranges) {
    while (
      replacementIndex < replacements.length &&
      replacements[replacementIndex].end <= range.start
    ) {
      const replacement = replacements[replacementIndex];
      delta += replacement.length - (replacement.end - replacement.start);
      replacementIndex++;
    }
    out.push({ start: range.start + delta, end: range.end + delta });
  }
  return out;
}

/**
 * Merge two sorted protected-range lists into one sorted list, coalescing
 * overlaps and adjacent (touching) ranges.
 *
 * Both `a` and `b` must already be sorted by `start` ascending with no
 * intra-list overlaps. The result is also sorted and overlap-free.
 *
 * @param a - First sorted list of protected ranges.
 * @param b - Second sorted list of protected ranges.
 * @returns A new sorted, coalesced list containing every range from both
 *   inputs, with overlaps and touching spans merged.
 */
export function mergeRanges(a: ProtectedRange[], b: ProtectedRange[]): ProtectedRange[] {
  if (!a.length) return b;
  if (!b.length) return a;

  const out: ProtectedRange[] = [];
  let i = 0;
  let j = 0;
  // Merge-sort walk: pick the range with the smaller `start` at each step.
  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && a[i].start <= b[j].start);
    const range = takeA ? a[i++] : b[j++];
    const last = out[out.length - 1];
    // Coalesce when the next range overlaps or touches the previous output range.
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      out.push({ start: range.start, end: range.end });
    }
  }
  return out;
}
