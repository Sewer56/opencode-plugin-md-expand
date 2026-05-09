import { describe, test, expect } from "bun:test";
import path from "node:path";

import { defaultConfigDirs } from "./config-discovery";
import { resolveEffectiveConfigDirs } from "./index";

describe("resolveEffectiveConfigDirs", () => {
  const projectDir = "/project";

  test("returns defaults when neither configDirs nor extraConfigDirs are set", () => {
    const result = resolveEffectiveConfigDirs({ configDirs: [], extraConfigDirs: [] }, projectDir);
    expect(result).toEqual(defaultConfigDirs(projectDir));
  });

  test("appends extraConfigDirs to defaults", () => {
    const extra = ["/extra/one", "/extra/two"];
    const result = resolveEffectiveConfigDirs(
      { configDirs: [], extraConfigDirs: extra },
      projectDir,
    );
    expect(result).toEqual([...defaultConfigDirs(projectDir), ...extra]);
  });

  test("returns configDirs as-is when set (override mode)", () => {
    const override = ["/override"];
    const result = resolveEffectiveConfigDirs(
      { configDirs: override, extraConfigDirs: ["/ignored"] },
      projectDir,
    );
    expect(result).toEqual(override);
  });

  test("extraConfigDirs is ignored when configDirs is set", () => {
    const result = resolveEffectiveConfigDirs(
      { configDirs: ["/override"], extraConfigDirs: ["/should-be-ignored"] },
      projectDir,
    );
    expect(result).not.toContain("/should-be-ignored");
    expect(result).toEqual(["/override"]);
  });

  test("extraConfigDirs appended after all three defaults", () => {
    const result = resolveEffectiveConfigDirs(
      { configDirs: [], extraConfigDirs: ["/tail"] },
      projectDir,
    );
    const defaults = defaultConfigDirs(projectDir);
    expect(result.length).toBe(defaults.length + 1);
    expect(result[defaults.length]).toBe("/tail");
  });

  test("empty extraConfigDirs yields same result as no extraConfigDirs", () => {
    const withEmpty = resolveEffectiveConfigDirs(
      { configDirs: [], extraConfigDirs: [] },
      projectDir,
    );
    const without = resolveEffectiveConfigDirs({ configDirs: [], extraConfigDirs: [] }, projectDir);
    expect(withEmpty).toEqual(without);
  });
});
