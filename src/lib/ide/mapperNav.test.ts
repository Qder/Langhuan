import { describe, expect, it } from "vitest";
import {
  findMapperInterfaceForXml,
  findMapperXmlForMethod,
  findMethodDeclarationLine,
  findXmlStatementLine,
  javaTypeFqn,
  looksLikeMapperInterface,
  mapperSimpleName,
  xmlMapperNamespace,
  xmlStatementIdAtOffset,
} from "./mapperNav";

const MAPPER_JAVA = `package com.campus.food.mapper;

import java.util.List;

public interface MerchantMapper {
  List<Merchant> selectByCondition(MerchantQueryDTO query);
  Merchant selectById(Long id);
}
`;

const MAPPER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="com.campus.food.mapper.MerchantMapper">
  <resultMap id="BaseMap" type="Merchant"/>
  <select id="selectByCondition" resultType="Merchant">
    SELECT * FROM merchant
  </select>
  <select id="selectById" resultType="Merchant">
    SELECT * FROM merchant WHERE id = #{id}
  </select>
</mapper>
`;

function readerOf(files: Record<string, string>) {
  return async (path: string) => {
    const body = files[path];
    if (body == null) throw new Error(`no such file: ${path}`);
    return body;
  };
}

describe("javaTypeFqn", () => {
  it("joins package and file leaf", () => {
    expect(javaTypeFqn(MAPPER_JAVA, "src/main/java/com/campus/food/mapper/MerchantMapper.java")).toBe(
      "com.campus.food.mapper.MerchantMapper"
    );
  });

  it("returns the simple name without package", () => {
    expect(javaTypeFqn("public interface Foo {}", "src/Foo.java")).toBe("Foo");
  });
});

describe("xmlMapperNamespace / mapperSimpleName", () => {
  it("reads namespace", () => {
    expect(xmlMapperNamespace(MAPPER_XML)).toBe("com.campus.food.mapper.MerchantMapper");
  });

  it("handles missing namespace", () => {
    expect(xmlMapperNamespace("<mapper></mapper>")).toBeNull();
  });

  it("takes the last segment as class name", () => {
    expect(mapperSimpleName("com.a.b.FooMapper")).toBe("FooMapper");
    expect(mapperSimpleName(null)).toBeNull();
  });
});

describe("findXmlStatementLine", () => {
  it("finds the statement line and skips resultMap", () => {
    expect(findXmlStatementLine(MAPPER_XML, "selectByCondition")).toBe(4);
    expect(findXmlStatementLine(MAPPER_XML, "selectById")).toBe(7);
    expect(findXmlStatementLine(MAPPER_XML, "BaseMap")).toBeNull();
  });

  it("handles attributes wrapped across lines", () => {
    const wrapped = `<mapper namespace="x.Y">
  <select
      id="selectById"
      resultType="Y">
    SELECT 1
  </select>
</mapper>
`;
    expect(findXmlStatementLine(wrapped, "selectById")).toBe(2);
  });

  it("returns null for unknown id", () => {
    expect(findXmlStatementLine(MAPPER_XML, "nope")).toBeNull();
  });
});

describe("xmlStatementIdAtOffset", () => {
  it("hits the id value", () => {
    const line = `  <select id="selectByCondition" resultType="Merchant">`;
    const at = line.indexOf("selectByCondition");
    expect(xmlStatementIdAtOffset(line, at)).toBe("selectByCondition");
  });

  it("hits the tag body but not the SQL text below", () => {
    const line = `  <select id="selectById" resultType="Merchant">`;
    expect(xmlStatementIdAtOffset(line, line.indexOf("<select"))).toBe("selectById");
    expect(xmlStatementIdAtOffset("    SELECT * FROM merchant", 4)).toBeNull();
  });

  it("ignores tags without id", () => {
    expect(xmlStatementIdAtOffset("  </select>", 3)).toBeNull();
  });
});

describe("looksLikeMapperInterface", () => {
  it("accepts Mapper/Dao/Repository interfaces", () => {
    expect(looksLikeMapperInterface("a/MerchantMapper.java", MAPPER_JAVA)).toBe(true);
    expect(looksLikeMapperInterface("a/MerchantDao.java", "public interface MerchantDao {}")).toBe(true);
  });

  it("rejects ordinary classes and non-conventional names", () => {
    expect(looksLikeMapperInterface("a/MerchantMapper.java", "public class MerchantMapper {}")).toBe(false);
    expect(looksLikeMapperInterface("a/MerchantService.java", "public interface MerchantService {}")).toBe(false);
  });
});

describe("findMethodDeclarationLine", () => {
  it("finds the declaration, not the call site", () => {
    const body = `interface X {
  void f();
  default void g() { this.f(); }
}
`;
    expect(findMethodDeclarationLine(MAPPER_JAVA, "selectById")).toBe(7);
    expect(findMethodDeclarationLine(body, "f")).toBe(2);
  });

  it("misses unknown methods", () => {
    expect(findMethodDeclarationLine(MAPPER_JAVA, "selectByName")).toBeNull();
  });
});

describe("findMapperXmlForMethod", () => {
  const mapperPath = "src/main/java/com/campus/food/mapper/MerchantMapper.java";
  const xmlPath = "src/main/resources/mapper/MerchantMapper.xml";

  it("jumps to the matching statement line", async () => {
    const plan = await findMapperXmlForMethod({
      mapperPath,
      mapperFqn: "com.campus.food.mapper.MerchantMapper",
      method: "selectById",
      fileIndex: [mapperPath, xmlPath],
      readFile: readerOf({ [mapperPath]: MAPPER_JAVA, [xmlPath]: MAPPER_XML }),
    });
    expect(plan).toEqual({
      kind: "open",
      path: xmlPath,
      line: 7,
      namespace: "com.campus.food.mapper.MerchantMapper",
    });
  });

  it("refuses when the same method id lives in another namespace", async () => {
    const other = `<?xml version="1.0"?>
<mapper namespace="com.other.OrderMapper">
  <select id="selectById">SELECT 1</select>
</mapper>
`;
    const plan = await findMapperXmlForMethod({
      mapperPath,
      mapperFqn: "com.campus.food.mapper.MerchantMapper",
      method: "selectById",
      fileIndex: [mapperPath, xmlPath, "src/main/resources/mapper/OrderMapper.xml"],
      readFile: readerOf({
        [mapperPath]: MAPPER_JAVA,
        [xmlPath]: "<?xml version=\"1.0\"?>\n<mapper namespace=\"com.campus.food.mapper.MerchantMapper\"/>\n",
        "src/main/resources/mapper/OrderMapper.xml": other,
      }),
    });
    expect(plan.kind).toBe("miss");
    if (plan.kind === "miss") {
      expect(plan.reason).toContain("OrderMapper.xml");
    }
  });

  it("reports ambiguous when two XMLs share a namespace and both have the id", async () => {
    const dup = `<?xml version="1.0"?>
<mapper namespace="com.campus.food.mapper.MerchantMapper">
  <select id="selectById">SELECT 2</select>
</mapper>
`;
    const plan = await findMapperXmlForMethod({
      mapperPath,
      mapperFqn: "com.campus.food.mapper.MerchantMapper",
      method: "selectById",
      fileIndex: [mapperPath, xmlPath, "src/main/resources/mapper/DupMapper.xml"],
      readFile: readerOf({
        [mapperPath]: MAPPER_JAVA,
        [xmlPath]: MAPPER_XML,
        "src/main/resources/mapper/DupMapper.xml": dup,
      }),
    });
    expect(plan.kind).toBe("ambiguous");
    if (plan.kind === "ambiguous") {
      expect(plan.candidates.length).toBe(2);
      expect(plan.reason).toContain("namespace");
    }
  });

  it("misses when no XML declares that namespace", async () => {
    const plan = await findMapperXmlForMethod({
      mapperPath,
      mapperFqn: "com.campus.food.mapper.MerchantMapper",
      method: "selectById",
      fileIndex: [mapperPath],
      readFile: readerOf({ [mapperPath]: MAPPER_JAVA }),
    });
    expect(plan.kind).toBe("miss");
  });
});

describe("findMapperInterfaceForXml", () => {
  const mapperPath = "src/main/java/com/campus/food/mapper/MerchantMapper.java";
  const namespace = "com.campus.food.mapper.MerchantMapper";

  it("opens the interface method line", async () => {
    const plan = await findMapperInterfaceForXml({
      namespace,
      statementId: "selectByCondition",
      fileIndex: [mapperPath],
      readFile: readerOf({ [mapperPath]: MAPPER_JAVA }),
    });
    expect(plan).toEqual({
      kind: "open",
      path: mapperPath,
      line: 6,
      className: "MerchantMapper",
    });
  });

  it("refuses a same-named file whose package disagrees", async () => {
    const wrong = `package com.other.dept;
public interface MerchantMapper {
  Merchant selectById(Long id);
}
`;
    const plan = await findMapperInterfaceForXml({
      namespace,
      statementId: "selectById",
      fileIndex: ["legacy/MerchantMapper.java"],
      readFile: readerOf({ "legacy/MerchantMapper.java": wrong }),
    });
    expect(plan.kind).toBe("miss");
    if (plan.kind === "miss") {
      expect(plan.reason).toContain("namespace");
    }
  });

  it("reports ambiguous when two files claim the same FQN", async () => {
    const plan = await findMapperInterfaceForXml({
      namespace,
      statementId: "selectById",
      fileIndex: [mapperPath, "copy/MerchantMapper.java"],
      readFile: readerOf({
        [mapperPath]: MAPPER_JAVA,
        "copy/MerchantMapper.java": MAPPER_JAVA,
      }),
    });
    expect(plan.kind).toBe("ambiguous");
  });

  it("misses when the file exists but the method does not", async () => {
    const plan = await findMapperInterfaceForXml({
      namespace,
      statementId: "selectByPhone",
      fileIndex: [mapperPath],
      readFile: readerOf({ [mapperPath]: MAPPER_JAVA }),
    });
    expect(plan.kind).toBe("miss");
    if (plan.kind === "miss") {
      expect(plan.reason).toContain("selectByPhone");
    }
  });

  it("misses when no file matches the namespace leaf", async () => {
    const plan = await findMapperInterfaceForXml({
      namespace,
      statementId: "selectById",
      fileIndex: [],
      readFile: readerOf({}),
    });
    expect(plan.kind).toBe("miss");
  });
});
