import type { IfCondition } from "./types.js"

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
