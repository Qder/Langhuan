import { describe, expect, it } from "vitest";
import {
  IDE_RECENT_MAX,
  pushRecentProject,
  removeRecentProject,
  type IdeRecentProjectMeta,
} from "./recentProjects";

function meta(id: string, at = 1): IdeRecentProjectMeta {
  return { id, name: id, pathLabel: id, lastOpenedAt: at };
}

describe("pushRecentProject", () => {
  it("trims to 6 and moves existing to front", () => {
    let list: IdeRecentProjectMeta[] = [];
    for (let i = 1; i <= 7; i++) {
      list = pushRecentProject(list, meta(`p${i}`, i));
    }
    expect(list).toHaveLength(IDE_RECENT_MAX);
    expect(list.map((p) => p.id)).toEqual(["p7", "p6", "p5", "p4", "p3", "p2"]);

    list = pushRecentProject(list, meta("p4", 99));
    expect(list[0]?.id).toBe("p4");
    expect(list).toHaveLength(6);
    expect(list.filter((p) => p.id === "p4")).toHaveLength(1);
  });
});

describe("removeRecentProject", () => {
  it("removes by id", () => {
    const list = [meta("a"), meta("b")];
    expect(removeRecentProject(list, "a").map((p) => p.id)).toEqual(["b"]);
  });
});
