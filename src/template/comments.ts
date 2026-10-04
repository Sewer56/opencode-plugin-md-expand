/**
 * @module comments - Remove `<!--- ... --->` author comments from prompt text.
 *
 * Authors use these comments for notes and examples that the model should not see.
 * Normal HTML comments (`<!-- ... -->`) stay untouched.
 *
 * - {@link stripComments}: remove comments and, optionally, report bad ones.
 * - {@link CommentErrors}: bad comments found in one file, for validation.
 *
 * @example
 * ````md
 * Return early instead of nesting `if` blocks.
 *
 * <!---
 * For reviewers, the shape we want:
 *
 * ```rust
 * let Some(user) = find_user(id) else {
 *     return Err(Error::NotFound);
 * };
 * ```
 * --->
 *
 * Name errors after what went wrong, not where.
 * ````
 *
 * The model receives the two rules with one blank line between them.
 */

/** Opening marker. One dash more than HTML, so plain `<!--` stays literal. */
export const COMMENT_START = "<!---";

/** Closing marker; must end its line. */
const COMMENT_END = "--->";

/** Malformed comments found in one source file. */
export interface CommentErrors {
  /** Absolute path of the file. */
  path: string;
  /** Full file text, used to turn offsets into line and column numbers. */
  text: string;
  /** Reported malformed-comment offsets, in ascending order. */
  offsets: number[];
}

/**
 * Remove `<!--- ... --->` author comments that occupy whole lines.
 *
 * @param text - Prompt text that may contain comments.
 * @param errors - Optional sink for offsets of malformed comment openers, in ascending order.
 * @param removed - Optional sink for the `[start, end)` span of each removed comment.
 * @returns Text with all well-formed comments removed.
 *
 * # Errors
 *
 * Malformed comments are kept as written, and their opener offsets go to `errors`.
 * An opener is malformed when its first `--->` has more text after it on the line.
 * It is also malformed when no `--->` follows it; scanning then stops.
 *
 * # Remarks
 *
 * A comment starts where `<!---` is the first non-blank text on a line.
 * It ends at the first `--->` after that, which must be the last non-blank text on its line.
 * A `<!---` later on a line is ignored.
 *
 * The comment's lines are removed, including their line breaks.
 * If the line before the comment is blank, or the comment starts the text,
 * one blank line after it is removed too.
 * Spans in `removed` cover all of these dropped lines.
 *
 * Code blocks get no special treatment: comments inside them are removed.
 *
 * Text with no `<!---` is returned unchanged after a single search.
 */
export function stripComments(
  text: string,
  errors?: number[],
  removed?: { start: number; end: number }[],
): string {
  let start = text.indexOf(COMMENT_START);
  if (start === -1) return text;

  let out = "";
  let cursor = 0;
  // Start of text counts as blank, so a leading comment drops the blank line after it.
  let prevBlank = true;
  // Last `--->` found. Openers before it share it, so the search runs once per closer.
  let closeStart = -1;
  let closeLineEnd = 0;
  let closeValid = false;

  while (start !== -1) {
    // Check only the whitespace before each marker, skipping ordinary lines.
    const lineStart = findBlankLineStart(text, start);
    if (lineStart === -1) {
      start = text.indexOf(COMMENT_START, start + COMMENT_START.length);
      continue;
    }

    // Find the closing marker, reusing the last one when it is still ahead.
    const bodyStart = start + COMMENT_START.length;
    if (closeStart < bodyStart) {
      closeStart = text.indexOf(COMMENT_END, bodyStart);
      if (closeStart !== -1) {
        const closeEnd = closeStart + COMMENT_END.length;
        closeLineEnd = findLineEnd(text, closeEnd);
        closeValid = skipBlank(text, closeEnd, closeLineEnd) === closeLineEnd;
      }
    }

    // An unclosed comment leaves the rest of the text literal.
    if (closeStart === -1) {
      errors?.push(start);
      break;
    }

    // Keep malformed comments and look for the next marker.
    if (!closeValid) {
      errors?.push(start);
      start = text.indexOf(COMMENT_START, bodyStart);
      continue;
    }

    // Check the preceding retained line; adjacent removals share its blank state.
    if (lineStart > cursor) {
      prevBlank = findBlankLineStart(text, lineStart - 1, cursor) !== -1;
    }

    // Drop the comment's lines, plus one blank line if blank lines surround it.
    out += text.slice(cursor, lineStart);
    let resume = closeLineEnd < text.length ? closeLineEnd + 1 : closeLineEnd;
    if (prevBlank && resume < text.length) {
      const followingEnd = findLineEnd(text, resume);
      if (skipBlank(text, resume, followingEnd) === followingEnd) {
        resume = followingEnd < text.length ? followingEnd + 1 : followingEnd;
      }
    }
    removed?.push({ start: lineStart, end: resume });
    cursor = resume;
    start = text.indexOf(COMMENT_START, resume);
  }

  return cursor === 0 ? text : out + text.slice(cursor);
}

/** Return the line start if only spaces, tabs and `\r` precede `end`, or -1 otherwise. */
function findBlankLineStart(text: string, end: number, minimum = 0): number {
  for (let i = end - 1; i >= minimum; i--) {
    const code = text.charCodeAt(i);
    if (code === 10) return i + 1;
    if (code !== 32 && code !== 9 && code !== 13) return -1;
  }
  return minimum;
}

/** Return the index of the `\n` ending the line at `start`, or `text.length`. */
function findLineEnd(text: string, start: number): number {
  const end = text.indexOf("\n", start);
  return end === -1 ? text.length : end;
}

/** Advance past spaces, tabs and `\r` up to `end`. */
function skipBlank(text: string, i: number, end: number): number {
  while (i < end) {
    const code = text.charCodeAt(i);
    if (code !== 32 && code !== 9 && code !== 13) break;
    i++;
  }
  return i;
}
