import { describe, test, expect } from "bun:test";
import path from "node:path";

import { makeTmpDir, cleanup } from "../test-helpers";
import { executeValidate, runValidateCommand, collectTemplateFiles } from "./validate";

describe("collectTemplateFiles", () => {
  test("collects .md files", async () => {
    const dir = await makeTmpDir({
      "a.md": "test",
      "b.txt": "test",
      "c.js": "test",
    });
    cleanup.push(dir);

    const files = collectTemplateFiles([dir]);
    expect(files).toContain(path.join(dir, "a.md"));
    expect(files).toContain(path.join(dir, "b.txt"));
    expect(files).not.toContain(path.join(dir, "c.js"));
  });

  test("collects .mdc and .opencode files", async () => {
    const dir = await makeTmpDir({
      "a.mdc": "test",
      "b.opencode": "test",
    });
    cleanup.push(dir);

    const files = collectTemplateFiles([dir]);
    expect(files).toContain(path.join(dir, "a.mdc"));
    expect(files).toContain(path.join(dir, "b.opencode"));
  });

  test("recursively collects from subdirectories", async () => {
    const dir = await makeTmpDir({
      "root.md": "test",
      "sub/nested.md": "test",
    });
    cleanup.push(dir);

    const files = collectTemplateFiles([dir]);
    expect(files).toContain(path.join(dir, "root.md"));
    expect(files).toContain(path.join(dir, "sub/nested.md"));
  });
});

describe("executeValidate", () => {
  test("validates valid template", async () => {
    const dir = await makeTmpDir({
      "valid.md": "Hello {{arg:name}}!",
    });
    cleanup.push(dir);

    const exitCode = await executeValidate([path.join(dir, "valid.md")], {
      configDir: dir,
      arg: { name: "World" },
    });

    expect(exitCode).toBe(0);
  });

  test("reports missing file error", async () => {
    const dir = await makeTmpDir({
      "invalid.md": 'Content {{ file="nonexistent.md" }}',
    });
    cleanup.push(dir);

    const exitCode = await executeValidate([path.join(dir, "invalid.md")], { configDir: dir });

    // Missing file in template should cause validation error
    expect(exitCode).toBe(1);
  });

  test("validates all files in directory", async () => {
    const dir = await makeTmpDir({
      "a.md": "A={{arg:a}}",
      "b.md": "B={{arg:b}}",
    });
    cleanup.push(dir);

    const exitCode = await executeValidate([], {
      configDir: dir,
      arg: { a: "1", b: "2" },
    });

    expect(exitCode).toBe(0);
  });

  test("respects --max-depth option", async () => {
    const dir = await makeTmpDir({
      "shallow.md": "Test",
    });
    cleanup.push(dir);

    const exitCode = await executeValidate([path.join(dir, "shallow.md")], {
      configDir: dir,
      maxDepth: 1,
    });

    expect(exitCode).toBe(0);
  });

  test("enables debug logging", async () => {
    const dir = await makeTmpDir({
      "test.md": "Test",
    });
    cleanup.push(dir);

    const exitCode = await executeValidate([path.join(dir, "test.md")], {
      configDir: dir,
      debug: true,
    });

    expect(exitCode).toBe(0);
  });
});

describe("runValidateCommand", () => {
  test("parses --config-dir option", async () => {
    const dir = await makeTmpDir({
      "test.md": "Test",
    });
    cleanup.push(dir);

    const exitCode = await runValidateCommand(["--config-dir", dir]);
    expect(exitCode).toBe(0);
  });

  test("parses --max-depth option", async () => {
    const dir = await makeTmpDir({
      "test.md": "Test",
    });
    cleanup.push(dir);

    const exitCode = await runValidateCommand([path.join(dir, "test.md"), "--max-depth", "3"]);
    expect(exitCode).toBe(0);
  });

  test("parses multiple --arg options", async () => {
    const dir = await makeTmpDir({
      "test.md": "A={{arg:a}} B={{arg:b}}",
    });
    cleanup.push(dir);

    const exitCode = await runValidateCommand([
      path.join(dir, "test.md"),
      "--arg",
      "a=1",
      "--arg",
      "b=2",
    ]);

    expect(exitCode).toBe(0);
  });

  test("shows help on --help", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    const exitCode = await runValidateCommand(["--help"]);

    console.log = origLog;

    expect(exitCode).toBe(0);
    expect(output).toContain("Validate template files");
  });
});
