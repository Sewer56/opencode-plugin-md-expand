import { ARG_PREFIX, ENV_PREFIX, FILE_TEMPLATE_START, FILE_ATTR, IF_ATTR } from "../token-syntax";
import { skipTemplateSpace } from "./scanner";

/**
 * Fast transform gate - returns `true` if `text` contains any expandable token.
 * Exact file expansion still requires a closing `}}` later.
 *
 * @param text - Source text to scan.
 * @returns `true` when `text` contains at least one `{{ file=... }}`, `{{ if=... }}`,
 *   `{{arg:...}}`, or `{{env:...}}` token.
 */
export function hasExpandableToken(text: string): boolean {
  // Scan every `{{` occurrence for a known expandable token type
  let start = text.indexOf(FILE_TEMPLATE_START);
  while (start !== -1) {
    if (startsFileTemplate(text, start) || startsInlineIfTemplate(text, start)) return true;
    if (text.startsWith(ARG_PREFIX, start)) return true;
    if (text.startsWith(ENV_PREFIX, start)) return true;
    // Advance past current match to continue scanning
    start = text.indexOf(FILE_TEMPLATE_START, start + 1);
  }
  return false;
}

/**
 * Check whether `text` contains a `{{ file=... }}` template.
 *
 * @param text - Source text to scan.
 * @returns `true` when at least one file-template opening is found.
 */
export function hasFileTemplate(text: string): boolean {
  // Scan for any `{{` that begins a file template
  let start = text.indexOf(FILE_TEMPLATE_START);
  while (start !== -1) {
    if (startsFileTemplate(text, start)) return true;
    start = text.indexOf(FILE_TEMPLATE_START, start + 1);
  }
  return false;
}

/**
 * Check whether `text` contains an `{{ if=... }}` inline conditional template.
 *
 * @param text - Source text to scan.
 * @returns `true` when at least one inline-if opening is found.
 */
export function hasInlineConditionalTemplate(text: string): boolean {
  // Scan for any `{{` that begins an inline-if template
  let start = text.indexOf(FILE_TEMPLATE_START);
  while (start !== -1) {
    if (startsInlineIfTemplate(text, start)) return true;
    start = text.indexOf(FILE_TEMPLATE_START, start + 1);
  }
  return false;
}

/**
 * Fast check for `{{ file=... }}`. Requires `file` first by style rule.
 * Rejects `{{arg:}}` and `{{env:}}`.
 *
 * @param text - Source text containing the candidate opening.
 * @param start - Index of the `{{` opening to validate.
 * @returns `true` when `text` at `start` begins a file template.
 */
export function startsFileTemplate(text: string, start: number): boolean {
  // Must begin with the template opening delimiter
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false;
  // Skip whitespace between `{{` and the attribute name
  let i = skipTemplateSpace(text, start + FILE_TEMPLATE_START.length);
  if (!text.startsWith(FILE_ATTR, i)) return false;
  // Skip whitespace between the attribute name and `=`
  i = skipTemplateSpace(text, i + FILE_ATTR.length);
  return text.charCodeAt(i) === 61; // =
}

/**
 * Fast check for `{{ if=... }}`. Requires `if` first by style rule.
 *
 * @param text - Source text containing the candidate opening.
 * @param start - Index of the `{{` opening to validate.
 * @returns `true` when `text` at `start` begins an inline-if template.
 */
export function startsInlineIfTemplate(text: string, start: number): boolean {
  // Must begin with the template opening delimiter
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false;
  // Skip whitespace between `{{` and the attribute name
  let i = skipTemplateSpace(text, start + FILE_TEMPLATE_START.length);
  if (!text.startsWith(IF_ATTR, i)) return false;
  // Skip whitespace between the attribute name and `=`
  i = skipTemplateSpace(text, i + IF_ATTR.length);
  return text.charCodeAt(i) === 61; // =
}
