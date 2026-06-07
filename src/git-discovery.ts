import { execSync } from "node:child_process";

/** Module-level cache keyed by `startDir` to avoid repeated git invocations. */
const gitRootCache = new Map<string, string | undefined>();

/**
 * Find the git repository root containing `startDir`.
 *
 * Uses `git rev-parse --show-toplevel` with caching so repeated calls
 * for the same `startDir` within one expansion pass are free.
 *
 * @param startDir - Directory from which to search for a git root.
 * @returns Absolute path to the git root, or `undefined` when not inside a repo.
 */
export function findGitRoot(startDir: string): string | undefined {
  // Use has() so cached undefined (non-repo) is distinguished from cache miss.
  if (gitRootCache.has(startDir)) return gitRootCache.get(startDir);

  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const root = out.trim() || undefined;
    gitRootCache.set(startDir, root);
    return root;
  } catch {
    gitRootCache.set(startDir, undefined);
    return undefined;
  }
}

/**
 * Clear the module-level git-root cache.
 */
export function clearGitRootCache(): void {
  gitRootCache.clear();
}
