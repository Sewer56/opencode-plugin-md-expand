/**
 * @module v2 - Expand Markdown templates in OpenCode 2.
 *
 * OpenCode 2 calls `setup` to register hooks for context, compaction and
 * generation. These hooks expand system text and user messages.
 *
 * OpenCode 1 uses `v1.ts`. Both versions share the engine in `expand.ts`.
 */

import { defaultConfigDirs } from "./config-discovery";
import { createDebugLogger } from "./debug";
import { expand, hasExpandableToken } from "./expand";
import type { ExpandContext } from "./expand";
import type { MdExpandOptions, ResolvedMdExpandOptions } from "./options";
import { resolveMdExpandOptions } from "./options";
import { stripComments } from "./template/comments";
import { PLUGIN_ID } from "./v1";

/** Session event kinds that carry a mutable `system` array. */
const HOOKED_EVENTS = ["context", "compaction", "generate"] as const;

/** System text that OpenCode 2 lets plugins change. */
export interface V2SystemPart {
  type: string;
  text?: string;
}

/** A message part, which may contain text to expand. */
export interface V2MessagePart {
  type: string;
  text?: string;
}

/** Only the session event fields used by the expansion hook. */
export interface V2SessionEvent {
  system?: V2SystemPart[];
  messages?: {
    info?: { role?: string };
    role?: string;
    parts?: V2MessagePart[];
    content?: V2MessagePart[];
  }[];
  tools?: Record<string, unknown>;
  agent?: unknown;
}

/** OpenCode 2 context used to read options and register session hooks. */
export interface V2PluginContext {
  options?: Record<string, unknown>;
  location?: { directory?: string };
  session: {
    hook: (name: string, callback: (event: V2SessionEvent) => Promise<void> | void) => unknown;
  };
}

/** Settings and shared resources used to expand one session event. */
export interface HandleSessionEventInput {
  options: ResolvedMdExpandOptions;
  createContext: () => ExpandContext | undefined;
  logger?: { log: (...args: unknown[]) => void };
}

/**
 * Register the OpenCode 2 session hooks that expand templates.
 *
 * Both versions read the same options, so one `opencode.json` entry can
 * configure either version.
 *
 * @param ctx - OpenCode 2 context with options and a session hook registrar.
 * @returns A promise that resolves once setup registers all hooks.
 */
export async function setup(ctx: V2PluginContext): Promise<void> {
  const pluginOptions = (ctx.options ?? {}) as MdExpandOptions;
  const resolved = resolveMdExpandOptions(pluginOptions);
  const projectDir = ctx.location?.directory ?? process.cwd();
  // Match V1's directory fallback without importing from index.ts.
  const configDirs = resolved.configDirs.length
    ? resolved.configDirs
    : [...defaultConfigDirs(projectDir), ...resolved.extraConfigDirs];
  const effectiveOptions: ResolvedMdExpandOptions = {
    ...resolved,
    configDirs,
  };
  const logger = effectiveOptions.debug ? createDebugLogger(effectiveOptions) : undefined;
  const sharedReadCache = effectiveOptions.cache ? new Map<string, Promise<string>>() : undefined;
  const sharedExpandedFileCache = effectiveOptions.cache
    ? new Map<string, Promise<string>>()
    : undefined;
  logger?.log(
    `v2 init: projectDir=${projectDir} configDirs=${JSON.stringify(effectiveOptions.configDirs)}`,
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

  const handler = async (event: V2SessionEvent): Promise<void> => {
    await handleSessionEvent(event, {
      options: effectiveOptions,
      createContext,
      logger,
    });
  };

  for (const name of HOOKED_EVENTS) {
    await ctx.session.hook(name, handler);
  }
}

export default {
  id: PLUGIN_ID,
  setup,
};

/**
 * Expand templates in a session event without replacing the event.
 *
 * The expansion engine handles system text and user messages.
 * System text also loses its `<!--- --->` author comments.
 * Other messages and non-text parts stay unchanged.
 *
 * @param event - Session event (`context`, `compaction` or `generate`) to edit.
 * @param input - Resolved options, context factory and optional logger.
 * @returns A promise that resolves once expansion finishes.
 */
export async function handleSessionEvent(
  event: V2SessionEvent,
  input: HandleSessionEventInput,
): Promise<void> {
  const { options, createContext, logger } = input;

  // Remove author comments from system text, then expand its tokens.
  for (let i = 0; i < (event.system?.length ?? 0); i++) {
    const part = event.system![i]!;
    if (typeof part.text !== "string") continue;
    part.text = stripComments(part.text);
    if (!hasExpandableToken(part.text)) continue;
    logger?.log(`v2 system[${i}]: expanding tokens (${part.text.length} chars)`);
    part.text = await expand(part.text, process.cwd(), options, createContext());
  }

  // Expand tokens in user text; comments stay because users may paste HTML.
  for (const message of event.messages ?? []) {
    const role = message.info?.role ?? message.role;
    if (role !== "user") continue;
    const parts = message.parts ?? message.content ?? [];
    for (const part of parts) {
      if (part.type !== "text" || typeof part.text !== "string" || !hasExpandableToken(part.text))
        continue;
      part.text = await expand(part.text, process.cwd(), options, createContext());
    }
  }
}
