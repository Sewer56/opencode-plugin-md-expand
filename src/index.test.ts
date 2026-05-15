import { describe, test, expect } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";

import { defaultConfigDirs } from "./config-discovery";
import { MdExpandPlugin, resolveEffectiveConfigDirs } from "./index";
import { cleanup, makeTmpDir } from "./test-helpers";

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

describe("MdExpandPlugin cache option", () => {
  test("cache disabled by default sees file edits across transform calls", async () => {
    const dir = await makeTmpDir({ "value.txt": "one" });
    cleanup.push(dir);
    const transform = await createSystemTransform(dir, {});

    expect(await transformSystem(transform, `{{ file="./value.txt" }}`)).toBe("one");
    await fsp.writeFile(path.join(dir, "value.txt"), "two", "utf8");
    expect(await transformSystem(transform, `{{ file="./value.txt" }}`)).toBe("two");
  });

  test("cache enabled reuses resolved file text across transform calls", async () => {
    const dir = await makeTmpDir({ "value.txt": "one" });
    cleanup.push(dir);
    const transform = await createSystemTransform(dir, { cache: true });

    expect(await transformSystem(transform, `{{ file="./value.txt" }}`)).toBe("one");
    await fsp.writeFile(path.join(dir, "value.txt"), "two", "utf8");
    expect(await transformSystem(transform, `{{ file="./value.txt" }}`)).toBe("one");
  });

  test("cache keys include file-template args", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "name={{arg:name}}" });
    cleanup.push(dir);
    const transform = await createSystemTransform(dir, { cache: true });

    expect(await transformSystem(transform, `{{ file="./tmpl.txt" name=Alice }}`)).toBe(
      "name=Alice",
    );
    expect(await transformSystem(transform, `{{ file="./tmpl.txt" name=Bob }}`)).toBe("name=Bob");
  });
});

type SystemTransform = NonNullable<
  Awaited<ReturnType<typeof MdExpandPlugin>>["experimental.chat.system.transform"]
>;

async function createSystemTransform(
  dir: string,
  options: Record<string, unknown>,
): Promise<SystemTransform> {
  const hooks = await MdExpandPlugin(
    { directory: dir } as Parameters<typeof MdExpandPlugin>[0],
    { configDirs: [dir], ...options } as Parameters<typeof MdExpandPlugin>[1],
  );
  const transform = hooks["experimental.chat.system.transform"];
  if (!transform) throw new Error("missing system transform hook");
  return transform;
}

async function transformSystem(transform: SystemTransform, text: string): Promise<string> {
  const output = { system: [text] };
  await transform({} as Parameters<SystemTransform>[0], output);
  return output.system[0];
}
