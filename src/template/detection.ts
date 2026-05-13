import { ARG_PREFIX, ENV_PREFIX, FILE_TEMPLATE_START, FILE_ATTR, IF_ATTR } from "../token-syntax";
import { skipTemplateSpace } from "./scanner";

/** Fast transform gate. Exact file expansion still requires a closing `}}` later. */
export function hasExpandableToken(text: string): boolean {
  let start = text.indexOf(FILE_TEMPLATE_START);
  while (start !== -1) {
    if (startsFileTemplate(text, start) || startsInlineIfTemplate(text, start)) return true;
    if (text.startsWith(ARG_PREFIX, start)) return true;
    if (text.startsWith(ENV_PREFIX, start)) return true;
    start = text.indexOf(FILE_TEMPLATE_START, start + 1);
  }
  return false;
}

export function hasFileTemplate(text: string): boolean {
  let start = text.indexOf(FILE_TEMPLATE_START);
  while (start !== -1) {
    if (startsFileTemplate(text, start)) return true;
    start = text.indexOf(FILE_TEMPLATE_START, start + 1);
  }
  return false;
}

export function hasInlineConditionalTemplate(text: string): boolean {
  let start = text.indexOf(FILE_TEMPLATE_START);
  while (start !== -1) {
    if (startsInlineIfTemplate(text, start)) return true;
    start = text.indexOf(FILE_TEMPLATE_START, start + 1);
  }
  return false;
}

/** Fast check for `{{ file=... }}`. Requires `file` first by style rule. Rejects `{{arg:}}` and `{{env:}}`. */
export function startsFileTemplate(text: string, start: number): boolean {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false;
  let i = skipTemplateSpace(text, start + FILE_TEMPLATE_START.length);
  if (!text.startsWith(FILE_ATTR, i)) return false;
  i = skipTemplateSpace(text, i + FILE_ATTR.length);
  return text.charCodeAt(i) === 61; // =
}

/** Fast check for `{{ if=... }}`. Requires `if` first by style rule. */
export function startsInlineIfTemplate(text: string, start: number): boolean {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false;
  let i = skipTemplateSpace(text, start + FILE_TEMPLATE_START.length);
  if (!text.startsWith(IF_ATTR, i)) return false;
  i = skipTemplateSpace(text, i + IF_ATTR.length);
  return text.charCodeAt(i) === 61; // =
}
