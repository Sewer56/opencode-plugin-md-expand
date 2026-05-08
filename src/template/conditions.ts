import { ENV_CONDITION_PREFIX } from "../token-syntax"
import { isValidArgKey, isValidEnvKey } from "./scanner"

export interface IfCondition {
  source: "arg" | "env"
  key: string
  expected?: string
}

/**
 * Evaluate a parsed condition against the current arg scope and process env.
 *
 * Args supplied on the same file-template call override inherited scoped args.
 * Inline conditionals pass an empty template-arg map and therefore read only the
 * current scoped args or environment variables.
 */
export function shouldExpandForCondition(
  condition: IfCondition | undefined,
  scopedArgs: Map<string, string>,
  templateArgs: Map<string, string>,
): boolean {
  if (!condition) return true
  const actual = condition.source === "env"
    ? process.env[condition.key] ?? ""
    : templateArgs.has(condition.key)
      ? templateArgs.get(condition.key)!
      : scopedArgs.get(condition.key) ?? ""
  return condition.expected === undefined
    ? actual.length > 0
    : actual === condition.expected
}

/**
 * Parse the small `if` condition grammar shared by file imports and inline blocks.
 *
 * Supported forms are `arg`, `arg==value`, `env:NAME`, and `env:NAME==value`.
 * There is no expression parser, boolean algebra, negation, or empty-string
 * equality check; invalid input returns `undefined` so the caller can leave the
 * template literal intact for validation.
 */
export function parseIfCondition(raw: string): IfCondition | undefined {
  if (raw.length === 0) return undefined

  const equality = raw.indexOf("==")
  const key = equality === -1 ? raw : raw.slice(0, equality)
  const expected = equality === -1 ? undefined : raw.slice(equality + 2)
  if (expected !== undefined && expected.length === 0) return undefined

  if (key.startsWith(ENV_CONDITION_PREFIX)) {
    const envKey = key.slice(ENV_CONDITION_PREFIX.length)
    return isValidEnvKey(envKey) ? { source: "env", key: envKey, expected } : undefined
  }

  return isValidArgKey(key) ? { source: "arg", key, expected } : undefined
}
