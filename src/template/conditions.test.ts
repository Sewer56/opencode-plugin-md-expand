import { describe, test, expect } from "bun:test";

import { EMPTY_ARGS } from "../token-syntax";
import { parseIfCondition, shouldExpandForCondition, type IfCondition } from "./conditions";

// ════════════════════════════════════════════════════════════════════════════════
//  parseIfCondition
// ════════════════════════════════════════════════════════════════════════════════

describe("parseIfCondition", () => {
  // ── existing == behaviour (regression) ─────────────────────────────────────

  test("arg==value returns equality condition", () => {
    expect(parseIfCondition("mode==cached")).toEqual({
      source: "arg",
      key: "mode",
      expected: "cached",
      negated: false,
    });
  });

  test("env:NAME==value returns equality condition", () => {
    expect(parseIfCondition("env:CI==true")).toEqual({
      source: "env",
      key: "CI",
      expected: "true",
      negated: false,
    });
  });

  test("arg without operator returns truthiness condition", () => {
    expect(parseIfCondition("flag")).toEqual({
      source: "arg",
      key: "flag",
      expected: undefined,
      negated: false,
    });
  });

  test("arg== with empty expected returns undefined (invalid)", () => {
    expect(parseIfCondition("flag==")).toBeUndefined();
  });

  test("empty string returns undefined", () => {
    expect(parseIfCondition("")).toBeUndefined();
  });

  test("invalid arg key returns undefined", () => {
    expect(parseIfCondition("9bad==value")).toBeUndefined();
  });

  test("invalid env key returns undefined", () => {
    expect(parseIfCondition("env:9BAD==value")).toBeUndefined();
  });

  // ── new != behaviour ──────────────────────────────────────────────────────

  test("arg!=value returns negated equality condition", () => {
    expect(parseIfCondition("mode!=cached")).toEqual({
      source: "arg",
      key: "mode",
      expected: "cached",
      negated: true,
    });
  });

  test("env:NAME!=value returns negated equality condition", () => {
    expect(parseIfCondition("env:CI!=true")).toEqual({
      source: "env",
      key: "CI",
      expected: "true",
      negated: true,
    });
  });

  test("arg!= with empty expected returns negated truthiness condition", () => {
    expect(parseIfCondition("flag!=")).toEqual({
      source: "arg",
      key: "flag",
      expected: undefined,
      negated: true,
    });
  });

  test("env:NAME!= with empty expected returns negated truthiness condition", () => {
    expect(parseIfCondition("env:DEBUG!=")).toEqual({
      source: "env",
      key: "DEBUG",
      expected: undefined,
      negated: true,
    });
  });

  test("key!==value splits on != (not ==)", () => {
    // `flag!==value` should parse as key=flag, operator!=, expected==value
    expect(parseIfCondition("flag!==value")).toEqual({
      source: "arg",
      key: "flag",
      expected: "=value",
      negated: true,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
//  shouldExpandForCondition
// ════════════════════════════════════════════════════════════════════════════════

describe("shouldExpandForCondition", () => {
  // ── existing == behaviour (regression) ─────────────────────────────────────

  test("undefined condition returns true", () => {
    expect(shouldExpandForCondition(undefined, EMPTY_ARGS, EMPTY_ARGS)).toBe(true);
  });

  test("arg truthiness: present and non-empty → true", () => {
    const scoped = new Map([["flag", "1"]]);
    expect(shouldExpandForCondition({ source: "arg", key: "flag" }, scoped, EMPTY_ARGS)).toBe(true);
  });

  test("arg truthiness: absent → false", () => {
    expect(shouldExpandForCondition({ source: "arg", key: "flag" }, EMPTY_ARGS, EMPTY_ARGS)).toBe(
      false,
    );
  });

  test("arg equality: matching → true", () => {
    const scoped = new Map([["mode", "cached"]]);
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "mode", expected: "cached" },
        scoped,
        EMPTY_ARGS,
      ),
    ).toBe(true);
  });

  test("arg equality: non-matching → false", () => {
    const scoped = new Map([["mode", "live"]]);
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "mode", expected: "cached" },
        scoped,
        EMPTY_ARGS,
      ),
    ).toBe(false);
  });

  test("template args override scoped args", () => {
    const scoped = new Map([["mode", "live"]]);
    const template = new Map([["mode", "cached"]]);
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "mode", expected: "cached" },
        scoped,
        template,
      ),
    ).toBe(true);
  });

  // ── new != behaviour ──────────────────────────────────────────────────────

  test("arg!=value: actual differs → true", () => {
    const scoped = new Map([["mode", "live"]]);
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "mode", expected: "cached", negated: true },
        scoped,
        EMPTY_ARGS,
      ),
    ).toBe(true);
  });

  test("arg!=value: actual matches → false", () => {
    const scoped = new Map([["mode", "cached"]]);
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "mode", expected: "cached", negated: true },
        scoped,
        EMPTY_ARGS,
      ),
    ).toBe(false);
  });

  test("arg!=value: arg absent → true", () => {
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "mode", expected: "cached", negated: true },
        EMPTY_ARGS,
        EMPTY_ARGS,
      ),
    ).toBe(true);
  });

  test("arg!= (negated truthiness): arg absent → true", () => {
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "flag", expected: undefined, negated: true },
        EMPTY_ARGS,
        EMPTY_ARGS,
      ),
    ).toBe(true);
  });

  test("arg!= (negated truthiness): arg present → false", () => {
    const scoped = new Map([["flag", "1"]]);
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "flag", expected: undefined, negated: true },
        scoped,
        EMPTY_ARGS,
      ),
    ).toBe(false);
  });

  test("arg!= (negated truthiness): arg empty string → true", () => {
    const scoped = new Map([["flag", ""]]);
    expect(
      shouldExpandForCondition(
        { source: "arg", key: "flag", expected: undefined, negated: true },
        scoped,
        EMPTY_ARGS,
      ),
    ).toBe(true);
  });
});
