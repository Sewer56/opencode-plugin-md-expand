/**
 * Shared test helpers for co-located test files.
 *
 * Importing this module registers a global `afterEach` that cleans up
 * directories and files pushed into the {@link cleanup} array.
 *
 * @module test-helpers
 */
import { afterEach } from "bun:test"
import { resolveMdExpandOptions } from "./options"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Create a temporary directory containing the given files.
 *
 * Nested paths (e.g. `"sub/dir.txt"`) create intermediate directories
 * automatically. The caller should push the returned path into {@link cleanup}
 * for automatic removal after the test.
 *
 * @param files - Relative file paths mapped to their string contents.
 * @returns Absolute path to the created temp directory.
 */
export async function makeTmpDir(files: Record<string, string>): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "md-expand-test-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await fsp.mkdir(path.dirname(full), { recursive: true })
    await fsp.writeFile(full, content, "utf8")
  }
  return dir
}

/**
 * Paths (directories or files) to remove after each test.
 *
 * Push resolved paths here; the `afterEach` hook registered by this module
 * will remove them with `{ recursive: true, force: true }`.
 */
export const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length) {
    await fsp.rm(cleanup.pop()!, { recursive: true, force: true })
  }
})

/**
 * Temporarily set or delete an environment variable and return a restore function.
 *
 * Pass `undefined` as `value` to delete the variable. Call the returned
 * function to restore the original value (or re-delete if it was absent).
 *
 * @param key - Environment variable name.
 * @param value - Value to set, or `undefined` to delete.
 * @returns A function that restores the original state.
 */
export function withEnv(key: string, value: string | undefined): () => void {
  const orig = process.env[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
  return () => {
    if (orig === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = orig
    }
  }
}

/**
 * Resolve `MdExpandOptions` with optional overrides.
 *
 * Thin wrapper around `resolveMdExpandOptions` for test convenience.
 *
 * @param extra - Optional partial options forwarded to `resolveMdExpandOptions`.
 */
export function opts(extra?: Parameters<typeof resolveMdExpandOptions>[0]) {
  return resolveMdExpandOptions(extra)
}
