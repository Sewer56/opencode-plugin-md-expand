import { advanceRangeIndex, isInRange, type ProtectedRange } from "../ranges";
import {
  FILE_TEMPLATE_START,
  FILE_TEMPLATE_END,
  FILE_ATTR,
  IF_ATTR,
  EMPTY_RANGES,
} from "../token-syntax";
import type { IfCondition } from "./conditions";
import { parseIfCondition } from "./conditions";
import { skipTemplateSpace, scanTemplateKey, readTemplateValue, isValidArgKey } from "./scanner";

interface FileTemplateSpec {
  rawPath: string;
  args: Map<string, string>;
  condition?: IfCondition;
  /** Inclusive offset of the second `}` in the closing `}}`. */
  end: number;
  /**
   * Spans covering template-argument values (not the `file=` path).
   * Returned by `collectFileArgRanges` so callers can protect them
   * from outer env/inline-conditional expansion.
   */
  argValueRanges?: ProtectedRange[];
}

/**
 * Find the character spans of template-argument values in
 * `{{ file="..." key=value }}` templates, excluding the `file=` path.
 *
 * Each `key=value` pair after `file=` is a "template argument" whose value
 * is passed literally to the included file. These spans must not be
 * env-expanded at the outer level; they stay literal so the included file
 * receives them as-is and can resolve them in its own recursive expansion.
 * Callers merge the returned ranges into `protectedRanges` so the env
 * and inline-conditional passes skip them.
 *
 * The `file=` path is intentionally excluded so tokens like
 * `{{env:PATH_PART}}` inside the path *are* expanded at the outer level,
 * enabling dynamic path composition.
 *
 * @example
 * In `{{ file="./tmpl" x="{{env:FOO}}" }}`, this returns the span covering
 * `{{env:FOO}}`. The env pass then skips it; `parseFileTemplate` later reads
 * it as the literal string `{{env:FOO}}`, and the included file sees it as
 * the value of `{{arg:x}}`.
 */
export function collectFileArgRanges(
  text: string,
  protectedRanges: ProtectedRange[],
): ProtectedRange[] {
  if (text.indexOf(FILE_TEMPLATE_START) === -1) return EMPTY_RANGES;

  const ranges: ProtectedRange[] = [];
  let searchFrom = 0;
  let protectedIndex = 0;

  while (true) {
    const start = text.indexOf(FILE_TEMPLATE_START, searchFrom);
    if (start === -1) break;

    protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, start);
    if (isInRange(protectedRanges, protectedIndex, start)) {
      searchFrom = protectedRanges[protectedIndex].end;
      continue;
    }

    const parsed = parseFileTemplate(text, start, protectedRanges, true);
    if (!parsed) {
      searchFrom = start + FILE_TEMPLATE_START.length;
      continue;
    }

    if (parsed.argValueRanges) ranges.push(...parsed.argValueRanges);
    searchFrom = parsed.end + 1;
  }

  return ranges.length ? ranges : EMPTY_RANGES;
}

/**
 * Parse one `{{ file="..." ... }}` template.
 *
 * Grammar stays intentionally small and scanner-only for prompt hot path:
 * - `file` must be the first attribute
 * - attributes are `key=value`; whitespace around `=` is allowed
 * - values are unquoted until whitespace/`}}`, or double-quoted with spaces
 * - common escapes decode in values: `\n`, `\r`, `\t`, `\b`, `\f`, `\v`, `\"`, `\\`
 * - duplicate arg keys use last value; duplicate `file` overwrites path
 * - `if=arg` checks non-empty; `if=arg==value` checks exact equality
 *
 * # Errors
 * Returns `undefined` when the text at `start` does not match a valid
 * file-template grammar. Callers treat `undefined` as "not a file template"
 * and leave the text literally.
 *
 * Specific failure modes:
 * - text at `start` does not begin with `{{`
 * - first attribute key is missing or is not `file=`
 * - `=` absent after `file` or any attribute key
 * - a value is empty or malformed (`readTemplateValue` returns `undefined`)
 * - `if=` condition is malformed (`parseIfCondition` returns `undefined`)
 * - end of `text` reached without a closing `}}`
 */
export function parseFileTemplate(
  text: string,
  start: number,
  protectedRanges: ProtectedRange[],
  collectArgRanges = false,
): FileTemplateSpec | undefined {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return undefined;

  let i = start + FILE_TEMPLATE_START.length;
  i = skipTemplateSpace(text, i);

  const firstKeyStart = i;
  i = scanTemplateKey(text, i);
  if (i === firstKeyStart || text.slice(firstKeyStart, i) !== FILE_ATTR) return undefined;

  i = skipTemplateSpace(text, i);
  if (text.charCodeAt(i) !== 61) return undefined; // =
  i = skipTemplateSpace(text, i + 1);

  const fileValue = readTemplateValue(text, i, protectedRanges);
  if (!fileValue) return undefined;
  let rawPath = fileValue.value;
  i = fileValue.next;

  let args: Map<string, string> | undefined;
  let condition: IfCondition | undefined;
  let argValueRanges: ProtectedRange[] | undefined;

  while (i < text.length) {
    i = skipTemplateSpace(text, i);
    if (text.startsWith(FILE_TEMPLATE_END, i)) {
      return {
        rawPath,
        args: args ?? new Map(),
        condition,
        end: i + FILE_TEMPLATE_END.length - 1,
        argValueRanges,
      };
    }

    const keyStart = i;
    i = scanTemplateKey(text, i);
    if (i === keyStart) return undefined;
    const key = text.slice(keyStart, i);

    i = skipTemplateSpace(text, i);
    if (text.charCodeAt(i) !== 61) return undefined; // =
    i = skipTemplateSpace(text, i + 1);

    const value = readTemplateValue(text, i, protectedRanges);
    if (!value) return undefined;
    i = value.next;

    if (!isValidArgKey(key)) {
      continue;
    }

    if (key === FILE_ATTR) {
      rawPath = value.value;
      continue;
    }

    if (key === IF_ATTR) {
      condition = parseIfCondition(value.value);
      if (!condition) {
        return undefined;
      }
      continue;
    }

    if (!args) args = new Map();
    args.set(key, value.value);

    if (collectArgRanges) {
      if (!argValueRanges) argValueRanges = [];
      argValueRanges.push({ start: value.valueStart, end: value.valueEnd });
    }
  }

  return undefined;
}
