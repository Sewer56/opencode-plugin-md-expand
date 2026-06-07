import { describe, test, expect } from "bun:test";

import { hasExpandableToken, hasPathTemplate, startsPathTemplate } from "./detection";

describe("hasExpandableToken", () => {
  test("returns false for plain text", () => {
    expect(hasExpandableToken("Hello world")).toBe(false);
  });

  test("detects {{arg:key}}", () => {
    expect(hasExpandableToken("{{arg:name}}")).toBe(true);
  });

  test("detects {{env:VAR}}", () => {
    expect(hasExpandableToken("{{env:HOME}}")).toBe(true);
  });

  test('detects {{ file="..." }}', () => {
    expect(hasExpandableToken('{{ file="./test.md" }}')).toBe(true);
  });

  test("detects inline {{ if=... }}", () => {
    expect(hasExpandableToken("{{ if=DEBUG }}")).toBe(true);
  });

  test("returns false for single braces", () => {
    expect(hasExpandableToken("{not-a-token}")).toBe(false);
  });

  test("detects {{path:...}}", () => {
    expect(hasExpandableToken("{{path:./file.txt}}")).toBe(true);
  });

  test("detects {{gitpath:...}}", () => {
    expect(hasExpandableToken("{{gitpath:src/main.ts}}")).toBe(true);
  });
});

describe("hasPathTemplate", () => {
  test("returns true for {{path:...}}", () => {
    expect(hasPathTemplate("before {{path:./run.sh}} after")).toBe(true);
  });

  test("returns true for {{gitpath:...}}", () => {
    expect(hasPathTemplate("before {{gitpath:src/main.ts}} after")).toBe(true);
  });

  test("returns false when no path tokens", () => {
    expect(hasPathTemplate("plain text {{env:HOME}}")).toBe(false);
  });
});

describe("startsPathTemplate", () => {
  test("returns true for {{path: at offset", () => {
    expect(startsPathTemplate("xx{{path:./f}}", 2)).toBe(true);
  });

  test("returns true for {{gitpath: at offset", () => {
    expect(startsPathTemplate("xx{{gitpath:./f}}", 2)).toBe(true);
  });

  test("returns false for {{arg: at offset", () => {
    expect(startsPathTemplate("xx{{arg:foo}}", 2)).toBe(false);
  });
});
