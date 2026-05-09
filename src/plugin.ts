import type { Plugin, PluginOptions } from "@opencode-ai/plugin";

import { defaultConfigDirs } from "./config-discovery";
import { createDebugLogger } from "./debug";
import { expand, hasExpandableToken } from "./expand";
import type { MdExpandOptions } from "./options";
import { resolveMdExpandOptions } from "./options";

export const PLUGIN_ID = "opencode-plugin-md-expand";

export const MdExpandPlugin: Plugin = async (input, options) => {
  const pluginOptions = normalizePluginOptions(options);
  const resolved = resolveMdExpandOptions(pluginOptions);
  const effectiveOptions = {
    ...resolved,
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
      for (let i = 0; i < output.system.length; i++) {
        const entry = output.system[i];
        if (!hasExpandableToken(entry)) continue;
        logger.log(`system[${i}]: expanding tokens (${entry.length} chars)`);
        output.system[i] = await expand(entry, input.directory, effectiveOptions);
      }
    },
  } as unknown as Awaited<ReturnType<Plugin>>;
};

export default {
  id: PLUGIN_ID,
  server: MdExpandPlugin,
};

export function normalizePluginOptions(options?: PluginOptions): MdExpandOptions {
  return (options as MdExpandOptions | undefined) ?? {};
}
