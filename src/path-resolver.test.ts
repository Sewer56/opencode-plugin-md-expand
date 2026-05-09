import { describe, test, expect } from "bun:test";
import os from "node:os";
import path from "node:path";

import { resolvePath } from "./path-resolver";

describe("resolvePath", () => {
  const base = "/project";

  test("~/... resolves to $HOME", () => {
    expect(resolvePath("~/foo", base)).toBe(path.join(os.homedir(), "foo"));
  });

  test("bare ~ resolves to $HOME", () => {
    expect(resolvePath("~", base)).toBe(os.homedir());
  });

  test("./... resolves relative to baseDir", () => {
    expect(resolvePath("./src/main.ts", base)).toBe(path.resolve(base, "./src/main.ts"));
  });

  test("../... resolves relative to baseDir", () => {
    expect(resolvePath("../sibling/file.txt", base)).toBe(
      path.resolve("/project", "../sibling/file.txt"),
    );
  });

  test("absolute path used as-is", () => {
    const absPath = path.resolve("/etc/hosts");
    expect(resolvePath(absPath, base)).toBe(absPath);
  });

  test("bare name (no prefix) resolves relative to baseDir", () => {
    expect(resolvePath("README.md", base)).toBe(path.resolve(base, "README.md"));
  });
});
