import { ENV_CONDITION_PREFIX } from "../token-syntax";
import { isValidArgKey, isValidEnvKey } from "./scanner";

export interface IfCondition {
  source: "arg" | "env";
  key: string;
  expected?: string;
  /** When true the comparison is negated (`!=` instead of `==`). */
  negated?: boolean;
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
  if (!condition) return true;
  const actual =
    condition.source === "env"
      ? (process.env[condition.key] ?? "")
      : templateArgs.has(condition.key)
        ? templateArgs.get(condition.key)!
        : (scopedArgs.get(condition.key) ?? "");
  if (condition.expected === undefined) {
    return condition.negated ? actual.length === 0 : actual.length > 0;
  }
  return condition.negated ? actual !== condition.expected : actual === condition.expected;
}

/**
 * Parse the small `if` condition grammar shared by file imports and inline blocks.
 *
 * Supported forms are `arg`, `arg==value`, `arg!=value`, `env:NAME`,
 * `env:NAME==value`, and `env:NAME!=value`. `!=` is checked before `==` so
 * that `key!==value` parses as `!=` with expected `=value` rather than `==`
 * with a corrupted key.
 *
 * `arg!=` (empty expected with `!=`) is valid and means "arg is empty or absent"
 * (negated truthiness). `arg==` (empty expected with `==`) remains invalid and
 * returns `undefined`.
 *
 * There is no expression parser, boolean algebra, or empty-string equality
 * check beyond the forms above; invalid input returns `undefined` so the
 * caller can leave the template literal intact for validation.
 */
export function parseIfCondition(raw: string): IfCondition | undefined {
  if (raw.length === 0) return undefined;

  // Check `!=` before `==` so `key!==value` splits on the `!=` at position
  // rather than the `==` one character later.
  const inequality = raw.indexOf("!=");
  const equality = raw.indexOf("==");

  let negated: boolean;
  let splitAt: number;
  if (inequality !== -1 && (equality === -1 || inequality < equality)) {
    negated = true;
    splitAt = inequality;
  } else if (equality !== -1) {
    negated = false;
    splitAt = equality;
  } else {
    // No operator - plain truthiness check.
    negated = false;
    splitAt = -1;
  }

  const key = splitAt === -1 ? raw : raw.slice(0, splitAt);
  let expected: string | undefined = splitAt === -1 ? undefined : raw.slice(splitAt + 2);

  // `==` with empty expected is invalid (e.g. `flag==`).
  // `!=` with empty expected is valid (negated truthiness: "flag is empty/absent"),
  // normalized to `expected: undefined` so the truthiness branch handles it.
  if (expected !== undefined && expected.length === 0) {
    if (!negated) return undefined;
    expected = undefined;
  }

  if (key.startsWith(ENV_CONDITION_PREFIX)) {
    const envKey = key.slice(ENV_CONDITION_PREFIX.length);
    return isValidEnvKey(envKey) ? { source: "env", key: envKey, expected, negated } : undefined;
  }

  return isValidArgKey(key) ? { source: "arg", key, expected, negated } : undefined;
}
