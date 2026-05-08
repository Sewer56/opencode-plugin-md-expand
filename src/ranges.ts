import type { ProtectedRange } from "./types.js"

/** Advance range cursor while `pos` is after current range. Ranges are sorted. */
export function advanceRangeIndex(ranges: ProtectedRange[], index: number, pos: number): number {
  while (index < ranges.length && ranges[index].end <= pos) index++
  return index
}

/** Check whether `pos` falls inside `ranges[index]`. */
export function isInRange(ranges: ProtectedRange[], index: number, pos: number): boolean {
  const range = ranges[index]
  return range !== undefined && pos >= range.start && pos < range.end
}

/** Merge two sorted protected-range lists, coalescing overlaps/touches. */
export function mergeRanges(a: ProtectedRange[], b: ProtectedRange[]): ProtectedRange[] {
  if (!a.length) return b
  if (!b.length) return a

  const out: ProtectedRange[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && a[i].start <= b[j].start)
    const range = takeA ? a[i++] : b[j++]
    const last = out[out.length - 1]
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end
    } else {
      out.push({ start: range.start, end: range.end })
    }
  }
  return out
}
