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
 * `configDirs` overrides the default directories entirely. `extraConfigDirs`
 * appends additional directories to the defaults and is useful in static
 * config (e.g. `opencode.json`) where runtime paths like project root and cwd
 * cannot be expressed. When `configDirs` is set, `extraConfigDirs` is ignored.
 *
 * @param input   - OpenCode plugin input carrying the project directory.
 * @param options - Optional plugin options forwarded to `resolveMdExpandOptions`.
 * @returns Plugin hooks object consumed by the OpenCode runtime.
 */

/**
 * Compute the effective `configDirs` list from resolved options and the
 * project directory.
 *
 * When `configDirs` is set (override mode) the caller-supplied list is
 * returned as-is and `extraConfigDirs` is ignored. Otherwise the default
 * directories (project root, cwd, XDG) are prepended and `extraConfigDirs`
 * are appended (additive mode).
 *
 * @param resolved   - Fully resolved plugin options from `resolveMdExpandOptions`.
 * @param projectDir - The project directory supplied by the OpenCode host.
 * @returns The final list of config directories to use.
 */
export function resolveEffectiveConfigDirs(
  resolved: { configDirs: string[]; extraConfigDirs: string[] },
  projectDir: string,
): string[] {
  return resolved.configDirs.length
    ? resolved.configDirs
    : [...defaultConfigDirs(projectDir), ...resolved.extraConfigDirs];
}

export const MdExpandPlugin: Plugin = async (input, options) => {
  const pluginOptions = normalizePluginOptions(options);
  const resolved = resolveMdExpandOptions(pluginOptions);
  const effectiveOptions = {
    ...resolved,
    configDirs: resolveEffectiveConfigDirs(resolved, input.directory),
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
    "experimental.chat.messages.transform": async (
      _input: unknown,
      output: { messages: { info: { role: string }; parts: { type: string; text?: string }[] }[] },
    ) => {
      // Expand tokens in text parts of user messages.
      for (const msg of output.messages) {
        if (msg.info.role !== "user") continue;
        for (let i = 0; i < msg.parts.length; i++) {
          const part = msg.parts[i];
          if (part.type !== "text" || !part.text) continue;
          if (!hasExpandableToken(part.text)) continue;
          logger.log(`user-message-part[${i}]: expanding tokens (${part.text.length} chars)`);
          part.text = await expand(part.text, input.directory, effectiveOptions);
        }
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
