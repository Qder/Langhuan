import { describe, expect, it } from "vitest";
import {
  candidatePathsForMethodSearch,
  findDefinitionLine,
  findDefinitionLineOrNull,
  isGotoDefinitionIdentifier,
  planGotoDefinition,
  resolveJavaTypeOfIdentifier,
  symbolAtOffset,
  wordAtOffset,
} from "./gotoDefinition";

describe("isGotoDefinitionIdentifier", () => {
  it("rejects keywords", () => {
    expect(isGotoDefinitionIdentifier("class")).toBe(false);
    expect(isGotoDefinitionIdentifier("if")).toBe(false);
    expect(isGotoDefinitionIdentifier("import")).toBe(false);
    expect(isGotoDefinitionIdentifier("public")).toBe(false);
  });

  it("accepts Foo", () => {
    expect(isGotoDefinitionIdentifier("Foo")).toBe(true);
  });
});

describe("planGotoDefinition", () => {
  it("opens unique src/Foo.java for word Foo", () => {
    expect(
      planGotoDefinition({
        word: "Foo",
        currentPath: "src/A.java",
        fileIndex: ["src/A.java", "src/Foo.java"],
      })
    ).toEqual({ kind: "open", path: "src/Foo.java", symbol: "Foo" });
  });

  it("returns candidates when two Foo.java", () => {
    const plan = planGotoDefinition({
      word: "Foo",
      currentPath: "src/A.java",
      fileIndex: ["a/Foo.java", "b/Foo.java"],
    });
    expect(plan.kind).toBe("candidates");
    if (plan.kind === "candidates") {
      expect(plan.candidates).toEqual(["a/Foo.java", "b/Foo.java"]);
      expect(plan.symbol).toBe("Foo");
    }
  });

  it("misses List when no List.java", () => {
    expect(
      planGotoDefinition({
        word: "List",
        currentPath: "src/A.java",
        fileIndex: ["src/A.java", "src/Foo.java"],
      })
    ).toEqual({ kind: "miss" });
  });

  it("resolves merchantMapper.selectByCondition via field type", () => {
    const content = `
package com.demo;
import com.demo.mapper.MerchantMapper;
public class MerchantServiceImpl {
  private final MerchantMapper merchantMapper;
  public List<Merchant> selectByCondition(MerchantQueryDTO q) {
    return merchantMapper.selectByCondition(q);
  }
}
`;
    const plan = planGotoDefinition({
      word: "selectByCondition",
      receiver: "merchantMapper",
      currentPath:
        "merchant-service/src/main/java/com/campus/food/campusfood/service/impl/MerchantServiceImpl.java",
      currentContent: content,
      fileIndex: [
        "merchant-service/src/main/java/com/campus/food/campusfood/service/impl/MerchantServiceImpl.java",
        "merchant-service/src/main/java/com/campus/food/campusfood/mapper/MerchantMapper.java",
        "merchant-service/src/main/resources/mapper/MerchantMapper.xml",
      ],
    });
    expect(plan).toEqual({
      kind: "open",
      path: "merchant-service/src/main/java/com/campus/food/campusfood/mapper/MerchantMapper.java",
      symbol: "selectByCondition",
    });
  });

  it("opens Mapper type when cursor is on merchantMapper field use", () => {
    const content = `private MerchantMapper merchantMapper;\nvoid f(){ merchantMapper.selectByCondition(q); }\n`;
    const plan = planGotoDefinition({
      word: "merchantMapper",
      currentPath: "src/Svc.java",
      currentContent: content,
      fileIndex: ["src/Svc.java", "src/MerchantMapper.java"],
    });
    expect(plan).toEqual({
      kind: "open",
      path: "src/MerchantMapper.java",
      symbol: "MerchantMapper",
    });
  });
});

describe("resolveJavaTypeOfIdentifier", () => {
  it("reads field type", () => {
    expect(
      resolveJavaTypeOfIdentifier(
        "private final MerchantMapper merchantMapper;",
        "merchantMapper"
      )
    ).toBe("MerchantMapper");
  });

  it("reads generic field type", () => {
    expect(
      resolveJavaTypeOfIdentifier("List<Merchant> list;", "list")
    ).toBe("List");
  });
});

describe("findDefinitionLine", () => {
  it("finds class Foo line", () => {
    const content = "package x;\n\npublic class Foo {\n}\n";
    expect(findDefinitionLine(content, "Foo")).toBe(3);
  });

  it("defaults to 1 when no match", () => {
    expect(findDefinitionLine("int x = 1;\n", "Foo")).toBe(1);
  });

  it("finds interface method selectByCondition", () => {
    const content = `package m;
public interface MerchantMapper {
  List<Merchant> selectByCondition(MerchantQueryDTO query);
}
`;
    expect(findDefinitionLineOrNull(content, "selectByCondition")).toBe(3);
  });

  it("finds MyBatis XML id", () => {
    const content = `<mapper>
  <select id="selectByCondition" resultType="Merchant">
    SELECT * FROM t
  </select>
</mapper>
`;
    expect(findDefinitionLineOrNull(content, "selectByCondition")).toBe(2);
  });

  it("skips call sites when looking for method", () => {
    const content = `class X {
  void f() {
    merchantMapper.selectByCondition(q);
  }
  List<Merchant> selectByCondition(MerchantQueryDTO q) { return null; }
}
`;
    expect(findDefinitionLineOrNull(content, "selectByCondition")).toBe(5);
  });
});

describe("symbolAtOffset", () => {
  it("reads receiver.method", () => {
    const line = "    List<Merchant> list = merchantMapper.selectByCondition(query);";
    const idx = line.indexOf("selectByCondition");
    expect(symbolAtOffset(line, idx)).toEqual({
      word: "selectByCondition",
      receiver: "merchantMapper",
    });
  });

  it("has null receiver without dot", () => {
    expect(symbolAtOffset("  Foo bar", 2)).toEqual({
      word: "Foo",
      receiver: null,
    });
  });
});

describe("wordAtOffset", () => {
  it("reads identifier under cursor", () => {
    expect(wordAtOffset("  Foo bar", 2)).toBe("Foo");
    expect(wordAtOffset("import Foo;", 8)).toBe("Foo");
  });
});

describe("candidatePathsForMethodSearch", () => {
  it("prefers Mapper.java then xml", () => {
    const paths = candidatePathsForMethodSearch("selectByCondition", [
      "a/Foo.java",
      "a/MerchantMapper.java",
      "a/MerchantMapper.xml",
      "a/notes.md",
    ]);
    expect(paths[0]).toBe("a/MerchantMapper.java");
    expect(paths).toContain("a/MerchantMapper.xml");
    expect(paths).toContain("a/Foo.java");
    expect(paths).not.toContain("a/notes.md");
  });
});
