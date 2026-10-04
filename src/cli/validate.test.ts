import { describe, test, expect } from "bun:test";
import path from "node:path";

import { makeTmpDir, cleanup } from "../test-helpers";
import { executeValidate, collectTemplateFiles } from "./validate";

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

  const MALFORMED = "malformed-comment <!---: comment needs a closing ---> at the end of a line";

  test.each([
    { name: "comment hides a broken include", content: '<!---\n{{ file="./x.md" }}\n--->', at: "" },
    { name: "comment is unclosed", content: "<!--- open\nText", at: "1:1" },
    { name: "text follows closing marker", content: "<!--- x ---> tail", at: "1:1" },
    { name: "leading blank lines and indent", content: "\n\n  <!--- open\nText", at: "3:3" },
    { name: "CRLF line endings", content: "a\r\n\r\n<!--- open\r\nText", at: "3:1" },
  ])("comment errors should match source when $name", async ({ content, at }) => {
    // Arrange
    const dir = await makeTmpDir({ "rule.md": content });
    cleanup.push(dir);
    const file = path.join(dir, "rule.md");

    // Act
    const { exitCode, lines } = await validateCapturing([file], dir);

    // Assert
    expect(exitCode).toBe(at ? 1 : 0);
    expect(lines).toEqual(at ? [`${file}:${at}: ${MALFORMED}`] : []);
  });

  test.each([
    {
      name: "broken include after a comment",
      content: 'a\n<!---\nnote\n--->\n{{ file="./x.md" }}',
      at: "5:1",
    },
    {
      name: "same include also inside a comment",
      content: '<!---\n{{ file="./x.md" }}\n--->\n\n{{ file="./x.md" }}',
      at: "5:1",
    },
    { name: "unclosed if after a comment", content: "<!--- x --->\n\n{{ if=a }}", at: "3:1" },
    {
      name: "open token spans a removed comment",
      content: "a\n<!---\nnote\n--->\n{{ if=a\n<!--- hidden --->\nnext",
      at: "5:1",
    },
  ])("template errors should point at source line when $name", async ({ content, at }) => {
    // Arrange
    const dir = await makeTmpDir({ "rule.md": content });
    cleanup.push(dir);
    const file = path.join(dir, "rule.md");

    // Act
    const { exitCode, lines } = await validateCapturing([file], dir);

    // Assert
    expect(exitCode).toBe(1);
    expect(lines.length).toBe(1);
    expect(lines[0]).toStartWith(`${file}:${at}: `);
  });

  test.each([
    { name: "direct include", root: '{{ file="./bad.md" }}' },
    { name: "nested include", root: '{{ file="./mid.md" }}' },
  ])("included comment error should be reported with $name", async ({ root }) => {
    // Arrange
    const dir = await makeTmpDir({
      "root.md": root,
      "mid.md": '{{ file="./bad.md" }}',
      "bad.md": "ok\n<!--- open\nText",
    });
    cleanup.push(dir);

    // Act
    const { exitCode, lines } = await validateCapturing([path.join(dir, "root.md")], dir);

    // Assert
    expect(exitCode).toBe(1);
    expect(lines).toEqual([`${path.join(dir, "bad.md")}:2:1: ${MALFORMED}`]);
  });

  test("repeated token error should be reported without a location", async () => {
    // Arrange
    const content = "<!--- x --->\n{{ if=a }}ok{{ endif }}\n{{ if=a }}";
    const dir = await makeTmpDir({ "rule.md": content });
    cleanup.push(dir);
    const file = path.join(dir, "rule.md");

    // Act
    const { exitCode, lines } = await validateCapturing([file], dir, { a: "yes" });

    // Assert
    expect(exitCode).toBe(1);
    expect(lines).toEqual([`${file}: unclosed/malformed token: {{ if=a }}`]);
  });

  test("included comment error should be reported once when file is also scanned", async () => {
    // Arrange
    const dir = await makeTmpDir({
      "a.md": '{{ file="./bad.md" }}',
      "b.md": '{{ file="./bad.md" }}',
      "bad.md": "<!--- open\nText",
    });
    cleanup.push(dir);

    // Act
    const { exitCode, lines } = await validateCapturing([dir], dir);

    // Assert
    expect(exitCode).toBe(1);
    expect(lines.length).toBe(1);
    expect(lines[0]).toStartWith(`${path.join(dir, "bad.md")}:1:1: malformed-comment`);
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

/**
 * Run `executeValidate` and capture its `console.log` lines.
 *
 * @param paths     - Files or directories to validate.
 * @param configDir - Config dir passed as `--config-dir`.
 * @param arg       - Optional top-level args passed as `--arg`.
 */
async function validateCapturing(
  paths: string[],
  configDir: string,
  arg?: Record<string, string>,
): Promise<{ exitCode: number; lines: string[] }> {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (line: string) => lines.push(line);
  console.error = () => {};
  try {
    const exitCode = await executeValidate(paths, { configDir, arg });
    return { exitCode, lines };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
