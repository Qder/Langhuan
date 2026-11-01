import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProjectAsset } from "./storage/contentApi";
import {
  assetReaderFrom,
  clearProjectAssetCache,
  loadProjectAssets,
  peekAsset,
} from "./projectAssetCache";

/** 造一个 Response 替身：只实现 fetchProjectAsset 用到的那几样。 */
function fakeResponse(bytes: Uint8Array, opts?: { status?: number; type?: string; length?: number }) {
  const status = opts?.status ?? 200;
  const headers = new Map<string, string>();
  if (opts?.length !== undefined) headers.set("content-length", String(opts.length));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    blob: async () => new Blob([bytes as unknown as BlobPart], { type: opts?.type ?? "application/octet-stream" }),
  };
}

const FONT_BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]);

beforeEach(() => {
  clearProjectAssetCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearProjectAssetCache();
});

describe("fetchProjectAsset", () => {
  it("按扩展名给 MIME（服务端说 octet-stream 也不受影响），字节原样 base64", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(FONT_BYTES, { type: "application/octet-stream" }))
    );
    const got = await fetchProjectAsset("demo/fonts/x.woff2");
    expect(got).not.toBeNull();
    if (got === null || got === "too-large") throw new Error("expected asset");
    expect(got.mime).toBe("font/woff2");
    expect(got.bytes).toBe(FONT_BYTES.length);
    expect(Buffer.from(got.base64, "base64")).toEqual(Buffer.from(FONT_BYTES));
  });

  it("404 → null（调用方据此报「缺少资源」）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(new Uint8Array(), { status: 404 })));
    expect(await fetchProjectAsset("demo/img/gone.png")).toBeNull();
  });

  it("content-length 超限就不读 body，直接 too-large", async () => {
    const blob = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "99999999" },
        blob,
      }))
    );
    expect(await fetchProjectAsset("demo/img/huge.png", { maxBytes: 1024 })).toBe("too-large");
    expect(blob).not.toHaveBeenCalled();
  });

  it("没有 content-length 时按实际体积判断", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(FONT_BYTES)));
    expect(await fetchProjectAsset("demo/img/a.png", { maxBytes: 2 })).toBe("too-large");
    expect(await fetchProjectAsset("demo/img/a.png", { maxBytes: 999 })).not.toBe("too-large");
  });
});

describe("projectAssetCache", () => {
  it("取一次、缓存复用：第二次不再 fetch", async () => {
    const fetchMock = vi.fn(async () => fakeResponse(FONT_BYTES));
    vi.stubGlobal("fetch", fetchMock);

    const first = await loadProjectAssets("demo", ["fonts/x.woff2"]);
    expect(first["fonts/x.woff2"]).toEqual({
      kind: "ok",
      mime: "font/woff2",
      base64: Buffer.from(FONT_BYTES).toString("base64"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekAsset("demo", "fonts/x.woff2")?.kind).toBe("ok");

    const second = await loadProjectAssets("demo", ["fonts/x.woff2"]);
    expect(second["fonts/x.woff2"]?.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("按项目隔离：换 root 不会串用同名文件", async () => {
    const fetchMock = vi.fn(async () => fakeResponse(FONT_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    await loadProjectAssets("a", ["img/x.png"]);
    await loadProjectAssets("b", ["img/x.png"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clearProjectAssetCache("a");
    expect(peekAsset("a", "img/x.png")).toBeUndefined();
    expect(peekAsset("b", "img/x.png")?.kind).toBe("ok");
  });

  it("失败也进缓存（missing / too-large），不会每次重试", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("missing")) return fakeResponse(new Uint8Array(), { status: 404 });
      return fakeResponse(FONT_BYTES, { length: 99_999_999 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const map = await loadProjectAssets("demo", ["img/missing.png", "img/huge.png"]);
    expect(map["img/missing.png"]).toEqual({ kind: "missing" });
    expect(map["img/huge.png"]).toEqual({ kind: "too-large" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const again = await loadProjectAssets("demo", ["img/missing.png", "img/huge.png"]);
    expect(again["img/missing.png"]).toEqual({ kind: "missing" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("assetReaderFrom", () => {
  it("表里没有 → pending（第一次渲染的正常态，不报警）", () => {
    const read = assetReaderFrom({});
    expect(read("img/a.png")).toBe("pending");
  });

  it("三种结果各自映射到 inlineProject 的契约", () => {
    const read = assetReaderFrom({
      "img/ok.png": { kind: "ok", mime: "image/png", base64: "AA==" },
      "img/gone.png": { kind: "missing" },
      "img/huge.png": { kind: "too-large" },
    });
    expect(read("img/ok.png")).toEqual({ mime: "image/png", base64: "AA==" });
    expect(read("img/gone.png")).toBe("missing");
    expect(read("img/huge.png")).toBe("too-large");
    expect(read("img/other.png")).toBe("pending");
  });
});
