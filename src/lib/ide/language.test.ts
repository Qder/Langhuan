import { describe, expect, it } from "vitest";
import { languageIdFromPath } from "./language";

describe("languageIdFromPath", () => {
  it("maps Java", () => {
    expect(languageIdFromPath("src/main/java/App.java")).toBe("java");
  });

  it("maps C++ family (extension point)", () => {
    expect(languageIdFromPath("foo.cpp")).toBe("cpp");
    expect(languageIdFromPath("bar.hpp")).toBe("cpp");
    expect(languageIdFromPath("baz.h")).toBe("cpp");
    expect(languageIdFromPath("x.cc")).toBe("cpp");
  });

  it("falls back to plaintext", () => {
    expect(languageIdFromPath("README")).toBe("plaintext");
    expect(languageIdFromPath("a.unknown")).toBe("plaintext");
  });
});
