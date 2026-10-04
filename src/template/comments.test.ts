import { describe, expect, test } from "bun:test";

import { stripComments } from "./comments";

// ── Core behavior ─────────────────────────────────────────────────────────────

describe("stripComments", () => {
  test.each([
    { name: "single-line comment", input: "a\n<!--- note --->\nb", expected: "a\nb" },
    { name: "multi-line comment", input: "a\n<!---\nline 1\nline 2\n--->\nb", expected: "a\nb" },
    {
      name: "fenced code inside comment",
      input: "a\n<!---\n```rs\nfn f() {}\n```\n--->\nb",
      expected: "a\nb",
    },
    {
      name: "template tokens inside comment",
      input: 'a\n<!--- {{ file="x" }} --->',
      expected: "a\n",
    },
    { name: "indented markers", input: "a\n  <!---\n  x\n  --->  \nb", expected: "a\nb" },
    { name: "CRLF line endings", input: "a\r\n<!--- x --->\r\nb", expected: "a\r\nb" },
    { name: "two comments", input: "<!--- x --->\na\n<!--- y --->\nb", expected: "a\nb" },
    {
      name: "comment inside code fence",
      input: "```md\n<!--- x --->\n```",
      expected: "```md\n```",
    },
  ])("should remove comment lines for $name", ({ input, expected }) => {
    // Act
    const result = stripComments(input);

    // Assert
    expect(result).toBe(expected);
  });

  test.each([
    { name: "between paragraphs", input: "a\n\n<!--- x --->\n\nb", expected: "a\n\nb" },
    { name: "at start of text", input: "<!--- x --->\n\nb", expected: "b" },
    { name: "at end of text", input: "a\n\n<!--- x --->", expected: "a\n\n" },
    { name: "touching text above", input: "a\n<!--- x --->\n\nb", expected: "a\n\nb" },
  ])("should keep blank-line spacing when comment is $name", ({ input, expected }) => {
    // Act
    const result = stripComments(input);

    // Assert
    expect(result).toBe(expected);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  test.each([
    { name: "plain HTML comment", input: "a\n<!-- keep -->\nb" },
    { name: "mid-line comment", input: "a <!--- keep --->\nb" },
    { name: "text without comments", input: "plain text" },
  ])("should keep text unchanged when $name", ({ input }) => {
    // Act
    const result = stripComments(input);

    // Assert
    expect(result).toBe(input);
  });

  test.each([
    { name: "comment is unclosed", input: "a\n<!--- open\nb", errorAt: 2 },
    { name: "text follows closing marker", input: "a\n<!--- x ---> tail\nb", errorAt: 2 },
  ])("should keep text and report error when $name", ({ input, errorAt }) => {
    // Arrange
    const errors: number[] = [];

    // Act
    const result = stripComments(input, errors);

    // Assert
    expect(result).toBe(input);
    expect(errors).toEqual([errorAt]);
  });

  test("should report every opener that shares one malformed closer", () => {
    // Arrange
    const input = "<!--- a\n<!--- b\n---> tail\nc";
    const errors: number[] = [];

    // Act
    const result = stripComments(input, errors);

    // Assert
    expect(result).toBe(input);
    expect(errors).toEqual([0, 8]);
  });

  test("should strip later comments when earlier comment is malformed", () => {
    // Arrange
    const errors: number[] = [];

    // Act
    const result = stripComments("<!--- x ---> tail\n<!--- y --->\nb", errors);

    // Assert
    expect(result).toBe("<!--- x ---> tail\nb");
    expect(errors).toEqual([0]);
  });
});
