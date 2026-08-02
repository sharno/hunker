import { describe, expect, it } from "vitest";

import { compileTextSearch } from "./code-search";

describe("code search", () => {
  it("matches literal text without treating punctuation as an expression", () => {
    const search = compileTextSearch("getInteger(key)", "literal");
    expect(search._tag).toBe("Valid");
    if (search._tag === "Invalid") return;
    expect(search.matches("return dconfig.getInteger(key); ")).toBe(true);
    expect(search.matches("return dconfig.getInteger; ")).toBe(false);
  });

  it("uses smart case for literal and regex searches", () => {
    const insensitive = compileTextSearch("dynamicconfig", "literal");
    const sensitive = compileTextSearch("DynamicConfig", "regex");
    expect(insensitive._tag).toBe("Valid");
    expect(sensitive._tag).toBe("Valid");
    if (insensitive._tag === "Invalid" || sensitive._tag === "Invalid") return;
    expect(insensitive.matches("DynamicConfigKey")).toBe(true);
    expect(sensitive.matches("DynamicConfigKey")).toBe(true);
    expect(sensitive.matches("dynamicconfigkey")).toBe(false);
  });

  it("reports invalid regular expressions", () => {
    const search = compileTextSearch("[", "regex");
    expect(search._tag).toBe("Invalid");
  });
});
