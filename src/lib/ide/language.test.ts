import { describe, expect, it } from "vitest";
import { languageIdFromPath } from "./language";

describe("languageIdFromPath", () => {
  it("maps Java", () => {
    expect(languageIdFromPath("src/main/java/App.java")).toBe("java");
  });

  it("maps C and C++ family", () => {
    expect(languageIdFromPath("foo.c")).toBe("c");
    expect(languageIdFromPath("foo.h")).toBe("c");
    expect(languageIdFromPath("foo.cpp")).toBe("cpp");
    expect(languageIdFromPath("bar.hpp")).toBe("cpp");
    expect(languageIdFromPath("x.cc")).toBe("cpp");
  });

  it("maps web / scripting stack", () => {
    expect(languageIdFromPath("a.js")).toBe("javascript");
    expect(languageIdFromPath("a.mjs")).toBe("javascript");
    expect(languageIdFromPath("a.jsx")).toBe("jsx");
    expect(languageIdFromPath("a.ts")).toBe("typescript");
    expect(languageIdFromPath("a.tsx")).toBe("tsx");
    expect(languageIdFromPath("a.json")).toBe("json");
    expect(languageIdFromPath("a.html")).toBe("html");
    expect(languageIdFromPath("a.css")).toBe("css");
    expect(languageIdFromPath("a.scss")).toBe("scss");
    expect(languageIdFromPath("a.less")).toBe("less");
    expect(languageIdFromPath("a.vue")).toBe("vue");
    expect(languageIdFromPath("a.php")).toBe("php");
  });

  it("maps systems / JVM / mobile languages", () => {
    expect(languageIdFromPath("a.py")).toBe("python");
    expect(languageIdFromPath("a.rs")).toBe("rust");
    expect(languageIdFromPath("a.go")).toBe("go");
    expect(languageIdFromPath("a.kt")).toBe("kotlin");
    expect(languageIdFromPath("a.kts")).toBe("kotlin");
    expect(languageIdFromPath("a.swift")).toBe("swift");
    expect(languageIdFromPath("a.scala")).toBe("scala");
    expect(languageIdFromPath("a.cs")).toBe("csharp");
    expect(languageIdFromPath("a.rb")).toBe("ruby");
    expect(languageIdFromPath("a.lua")).toBe("lua");
    expect(languageIdFromPath("a.dart")).toBe("dart");
  });

  it("maps data / config / shell", () => {
    expect(languageIdFromPath("a.yml")).toBe("yaml");
    expect(languageIdFromPath("a.yaml")).toBe("yaml");
    expect(languageIdFromPath("a.toml")).toBe("toml");
    expect(languageIdFromPath("a.xml")).toBe("xml");
    expect(languageIdFromPath("a.sql")).toBe("sql");
    expect(languageIdFromPath("a.sh")).toBe("shell");
    expect(languageIdFromPath("a.zsh")).toBe("shell");
    expect(languageIdFromPath("a.ps1")).toBe("powershell");
    expect(languageIdFromPath("a.md")).toBe("markdown");
    expect(languageIdFromPath("a.properties")).toBe("properties");
    expect(languageIdFromPath("a.proto")).toBe("protobuf");
  });

  it("maps special basenames", () => {
    expect(languageIdFromPath("Dockerfile")).toBe("dockerfile");
    expect(languageIdFromPath("path/to/dockerfile")).toBe("dockerfile");
    expect(languageIdFromPath("Makefile")).toBe("shell");
    expect(languageIdFromPath("Jenkinsfile")).toBe("groovy");
  });

  it("is case-insensitive on extension", () => {
    expect(languageIdFromPath("App.JAVA")).toBe("java");
    expect(languageIdFromPath("Lib.KT")).toBe("kotlin");
  });

  it("falls back to plaintext", () => {
    expect(languageIdFromPath("README")).toBe("plaintext");
    expect(languageIdFromPath("a.unknown")).toBe("plaintext");
    expect(languageIdFromPath("a.graphql")).toBe("plaintext");
  });
});
