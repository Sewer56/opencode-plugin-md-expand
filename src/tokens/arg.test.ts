import { describe, test, expect } from "bun:test";

import { expand } from "../expand";
import { opts } from "../test-helpers";

describe("expand: {{arg:...}} tokens", () => {
  test("expands {{arg:key}} from initialArgs", async () => {
    const result = await expand(
      "Hello {{arg:name}}!",
      "/tmp",
      opts({ initialArgs: { name: "World" } }),
    );
    expect(result).toBe("Hello World!");
  });

  test("blank for undefined arg from initialArgs", async () => {
    const result = await expand("Hello {{arg:missing}}!", "/tmp", opts());
    expect(result).toBe("Hello !");
  });
});
