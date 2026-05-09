import {
  TOKEN_START,
  ARG_PREFIX,
  ENV_PREFIX,
  FILE_TEMPLATE_START,
  FILE_ATTR,
  IF_ATTR,
} from "../token-syntax";
import { isTemplateSpace } from "./scanner";

/** Fast check for `{{ file=... }}`. Requires `file` first by style rule. Rejects `{{arg:}}` and `{{env:}}`. */
function startsFileTemplate(text: string, start: number): boolean {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false;
  let i = start + FILE_TEMPLATE_START.length;
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++;
  if (!text.startsWith(FILE_ATTR, i)) return false;
  i += FILE_ATTR.length;
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++;
  return text.charCodeAt(i) === 61; // =
}

/** Fast check for `{{ if=... }}`. Requires `if` first by style rule. */
function startsInlineIfTemplate(text: string, start: number): boolean {
  if (!text.startsWith(FILE_TEMPLATE_START, start)) return false;
  let i = start + FILE_TEMPLATE_START.length;
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++;
  if (!text.startsWith(IF_ATTR, i)) return false;
  i += IF_ATTR.length;
  while (i < text.length && isTemplateSpace(text.charCodeAt(i))) i++;
  return text.charCodeAt(i) === 61; // =
}

/** Fast transform gate. Exact file expansion still requires a closing `}}` later. */
export function hasExpandableToken(text: string): boolean {
  let start = text.indexOf(TOKEN_START);
  while (start !== -1) {
    // All expandable tokens start with `{{`: file templates, inline ifs,
    // {{arg:...}}, and {{env:...}}.
    if (text.charCodeAt(start + 1) === 123) {
      // {
      if (startsFileTemplate(text, start) || startsInlineIfTemplate(text, start)) return true;
      if (text.startsWith(ARG_PREFIX, start)) return true;
      if (text.startsWith(ENV_PREFIX, start)) return true;
    }
    start = text.indexOf(TOKEN_START, start + 1);
  }
  return false;
}
