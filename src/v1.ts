/**
 * @module v1 - Expand Markdown templates in OpenCode 1.
 *
 * OpenCode 1 calls `server` to get hooks for system prompts and user messages.
 * The hooks expand templates before the text reaches the model.
 *
 * Templates include `{{arg:*}}`, `{{env:*}}`, inline conditions and file
 * references.
 * System prompts also lose their `<!--- --->` author comments.
 * OpenCode 2 uses the same expansion engine in `expand.ts`.
 */

import type { Plugin, PluginOptions } from "@opencode-ai/plugin";

import { defaultConfigDirs } from "./config-discovery";
import { createDebugLogger } from "./debug";
import { expand, hasExpandableToken } from "./expand";
import type { ExpandContext } from "./expand";
import type { MdExpandOptions } from "./options";
import { resolveMdExpandOptions } from "./options";
import { stripComments } from "./template/comments";

/** Stable plugin ID used by OpenCode for registration and deduplication. */
export const PLUGIN_ID = "opencode-plugin-md-expand";

/**
 * Choose where to look for configuration files.
 *
 * If `configDirs` is not empty, use it as-is and ignore `extraConfigDirs`.
 * Otherwise, search `.opencode` under the project root and cwd, then the
 * XDG OpenCode directory. Search `extraConfigDirs` after those defaults.
 *
 * @param resolved - Options returned by `resolveMdExpandOptions`.
 * @param projectDir - Project directory supplied by OpenCode.
 * @returns Directories to search, in order.
 */
export function resolveEffectiveConfigDirs(
  resolved: { configDirs: string[]; extraConfigDirs: string[] },
  projectDir: string,
): string[] {
  return resolved.configDirs.length
    ? resolved.configDirs
    : [...defaultConfigDirs(projectDir), ...resolved.extraConfigDirs];
}

/**
 * Expand templates in OpenCode 1 system prompts and user messages.
 *
 * `configDirs` replaces the defaults and ignores `extraConfigDirs`.
 * Otherwise, `extraConfigDirs` adds directories after the defaults.
 *
 * Use `extraConfigDirs` in `opencode.json` when you cannot write paths known
 * only at runtime, such as the project root or cwd.
 *
 * @param input - OpenCode input containing the project directory.
 * @param options - Optional settings passed to `resolveMdExpandOptions`.
 * @returns Hooks for OpenCode to call before sending text to the model.
 */
export const MdExpandPlugin: Plugin = async (input, options) => {
  const pluginOptions = normalizePluginOptions(options);
  const resolved = resolveMdExpandOptions(pluginOptions);
  const effectiveOptions = {
    ...resolved,
    configDirs: resolveEffectiveConfigDirs(resolved, input.directory),
  };
  const logger = effectiveOptions.debug ? createDebugLogger(effectiveOptions) : undefined;
  const sharedReadCache = effectiveOptions.cache ? new Map<string, Promise<string>>() : undefined;
  const sharedExpandedFileCache = effectiveOptions.cache
    ? new Map<string, Promise<string>>()
    : undefined;
  logger?.log(
    `init: projectDir=${input.directory} configDirs=${JSON.stringify(effectiveOptions.configDirs)} cache=${effectiveOptions.cache}`,
  );

  const createContext = (): ExpandContext | undefined => {
    if (!effectiveOptions.cache) return undefined;
    return {
      visited: new Set(),
      depth: 0,
      readCache: sharedReadCache!,
      expandedFileCache: sharedExpandedFileCache,
      args: effectiveOptions.initialArgs,
      options: effectiveOptions,
      logger,
    };
  };

  return {
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      // Remove author comments, then expand tokens in each system-prompt entry in-place.
      for (let i = 0; i < output.system.length; i++) {
        const entry = stripComments(output.system[i]);
        output.system[i] = entry;
        if (!hasExpandableToken(entry)) continue;
        logger?.log(`system[${i}]: expanding tokens (${entry.length} chars)`);
        output.system[i] = await expand(entry, process.cwd(), effectiveOptions, createContext());
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
          logger?.log(`user-message-part[${i}]: expanding tokens (${part.text.length} chars)`);
          part.text = await expand(part.text, process.cwd(), effectiveOptions, createContext());
        }
      }
    },
  } as unknown as Awaited<ReturnType<Plugin>>;
};

export default {
  id: PLUGIN_ID,
  server: MdExpandPlugin,
};

/**
 * Use an empty options object when OpenCode provides none.
 *
 * OpenCode types the input as `PluginOptions`. The cast lets the options
 * resolver read this plugin's settings.
 *
 * @param options - Options supplied by OpenCode, if any.
 * @returns The plugin options, or an empty object if OpenCode provides none.
 */
export function normalizePluginOptions(options?: PluginOptions): MdExpandOptions {
  return (options as MdExpandOptions | undefined) ?? {};
}
