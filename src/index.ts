/**
 * @module index - Expose the plugin for OpenCode 1 and 2.
 *
 * The published package loads this entry from `dist`. OpenCode 1 uses its
 * `server` function; OpenCode 2 uses `setup`. For local directory plugins,
 * OpenCode 2 loads the root `server.ts` instead.
 *
 * Named exports remain available to the CLI and other callers.
 */

import { MdExpandPlugin, PLUGIN_ID } from "./v1";
import { setup } from "./v2";

export {
  MdExpandPlugin,
  PLUGIN_ID,
  normalizePluginOptions,
  resolveEffectiveConfigDirs,
} from "./v1";
export { setup, handleSessionEvent } from "./v2";
export type { V2PluginContext, V2SessionEvent } from "./v2";

export {
  /** Expand argument, environment, conditional and file templates in a string. */
  expand,
  /** Expand text and return the result with any issues found. */
  expandWithDiagnostics,
  /** Check whether a string contains any expandable template token. */
  hasExpandableToken,
  MAX_DEPTH,
  resolvePath,
} from "./expand";
export { resolveMdExpandOptions } from "./options";
export type { MdExpandOptions, ResolvedMdExpandOptions } from "./options";
export type { ExpandWithDiagnosticsResult, ExpansionDiagnostic } from "./expand";

/**
 * Let either OpenCode version load the published package.
 *
 * OpenCode 1 calls `server` and ignores `setup`. OpenCode 2 calls `setup` and
 * ignores `server`. Local directory plugins use `server.ts` for OpenCode 2.
 */
export default {
  id: PLUGIN_ID,
  setup,
  server: MdExpandPlugin,
};
