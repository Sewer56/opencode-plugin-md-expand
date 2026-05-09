/**
 * @module index - OpenCode plugin entry point for Markdown template expansion.
 *
 * Registers an `experimental.chat.system.transform` hook that expands
 * `{{arg:*}}`, `{{env:*}}`, inline `{{ if=... }}` conditionals, and
 * `{{ file="..." }}` templates in system-prompt entries before they reach
 * the model.
 */

import type { Plugin, PluginOptions } from "@opencode-ai/plugin";

import { defaultConfigDirs } from "./config-discovery";
import { createDebugLogger } from "./debug";
import { expand, hasExpandableToken } from "./expand";
import type { MdExpandOptions } from "./options";
import { resolveMdExpandOptions } from "./options";

export {
  /** Expand `{{arg:*}}`, `{{env:*}}`, inline conditionals, and file templates in a string. */
  expand,
  /** Expand a text string with diagnostics collection, returning both the result and any issues. */
  expandWithDiagnostics,
  /** Check whether a string contains any expandable template token. */
  hasExpandableToken,
  MAX_DEPTH,
  resolvePath,
} from "./expand";
export { resolveMdExpandOptions } from "./options";
export type { MdExpandOptions, ResolvedMdExpandOptions } from "./options";
export type { ExpandWithDiagnosticsResult, ExpansionDiagnostic } from "./expand";

/** Stable identifier for this plugin, used by OpenCode for registration and deduplication. */
export const PLUGIN_ID = "opencode-plugin-md-expand";

/**
 * OpenCode plugin that expands Markdown template tokens in system-prompt entries.
 *
 * On initialisation the plugin resolves its options (falling back to
 * `defaultConfigDirs` when none are provided) and registers a
 * `experimental.chat.system.transform` hook. The hook iterates over every
 * system-prompt string, checks for expandable tokens, and replaces each entry
 * with its fully-expanded form.
 *
 * @param input   - OpenCode plugin input carrying the project directory.
 * @param options - Optional plugin options forwarded to `resolveMdExpandOptions`.
 * @returns Plugin hooks object consumed by the OpenCode runtime.
 */
export const MdExpandPlugin: Plugin = async (input, options) => {
  const pluginOptions = normalizePluginOptions(options);
  const resolved = resolveMdExpandOptions(pluginOptions);
  const effectiveOptions = {
    ...resolved,
    // Fall back to project + XDG config dirs when the caller did not specify any.
    configDirs: resolved.configDirs.length
      ? resolved.configDirs
      : defaultConfigDirs(input.directory),
  };
  const logger = createDebugLogger(effectiveOptions);
  logger.log(
    `init: projectDir=${input.directory} configDirs=${JSON.stringify(effectiveOptions.configDirs)}`,
  );

  return {
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      // Expand tokens in each system-prompt entry in-place.
      for (let i = 0; i < output.system.length; i++) {
        const entry = output.system[i];
        if (!hasExpandableToken(entry)) continue;
        logger.log(`system[${i}]: expanding tokens (${entry.length} chars)`);
        output.system[i] = await expand(entry, input.directory, effectiveOptions);
      }
    },
  } as unknown as Awaited<ReturnType<Plugin>>;
};

/** Default plugin export with id and server for OpenCode auto-registration. */
export default {
  id: PLUGIN_ID,
  server: MdExpandPlugin,
};

/**
 * Narrow the generic `PluginOptions` bag to the plugin-specific `MdExpandOptions`.
 *
 * OpenCode passes an opaque options object; this function safely defaults to an
 * empty options bag when none is provided, so downstream resolvers never
 * receive `undefined`.
 *
 * @param options - The raw options object supplied by the OpenCode host.
 * @returns A typed (possibly empty) `MdExpandOptions` object.
 */
export function normalizePluginOptions(options?: PluginOptions): MdExpandOptions {
  return (options as MdExpandOptions | undefined) ?? {};
}
