import type { Extension } from "@codemirror/state";
import type { IdeLanguageId } from "./language";

/**
 * Map our short ids → `@codemirror/language-data` language names
 * (matchLanguageName accepts aliases like "csharp" too for some).
 */
const LANGUAGE_DATA_NAME: Partial<Record<IdeLanguageId, string>> = {
  c: "C",
  csharp: "C#",
  scss: "SCSS",
  sass: "Sass",
  less: "LESS",
  yaml: "YAML",
  toml: "TOML",
  php: "PHP",
  sql: "SQL",
  ruby: "Ruby",
  kotlin: "Kotlin",
  swift: "Swift",
  scala: "Scala",
  lua: "Lua",
  shell: "Shell",
  powershell: "PowerShell",
  dockerfile: "Dockerfile",
  vue: "Vue",
  dart: "Dart",
  haskell: "Haskell",
  r: "R",
  perl: "Perl",
  clojure: "Clojure",
  protobuf: "ProtoBuf",
  groovy: "Groovy",
  cmake: "CMake",
  properties: "Properties files",
};

async function loadFromLanguageData(name: string): Promise<Extension | Extension[]> {
  const { languages } = await import("@codemirror/language-data");
  const { LanguageDescription } = await import("@codemirror/language");
  const desc = LanguageDescription.matchLanguageName(languages, name, true);
  if (!desc) return [];
  return desc.load();
}

/**
 * Load a CM6 language extension for an IDE language id.
 * First-class packages for the common set already in package.json;
 * everything else via `@codemirror/language-data` (extension point).
 * Unknown / plaintext → no language support.
 */
export async function languageSupportFor(
  id: IdeLanguageId
): Promise<Extension | Extension[]> {
  try {
    switch (id) {
      case "java": {
        const { java } = await import("@codemirror/lang-java");
        return java();
      }
      case "cpp": {
        const { cpp } = await import("@codemirror/lang-cpp");
        return cpp();
      }
      case "javascript":
      case "jsx": {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ jsx: true });
      }
      case "typescript":
      case "tsx": {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ typescript: true, jsx: true });
      }
      case "json": {
        const { json } = await import("@codemirror/lang-json");
        return json();
      }
      case "markdown": {
        const { markdown } = await import("@codemirror/lang-markdown");
        return markdown();
      }
      case "html": {
        const { html } = await import("@codemirror/lang-html");
        return html();
      }
      case "css": {
        const { css } = await import("@codemirror/lang-css");
        return css();
      }
      case "xml": {
        const { xml } = await import("@codemirror/lang-xml");
        return xml();
      }
      case "python": {
        const { python } = await import("@codemirror/lang-python");
        return python();
      }
      case "rust": {
        const { rust } = await import("@codemirror/lang-rust");
        return rust();
      }
      case "go": {
        const { go } = await import("@codemirror/lang-go");
        return go();
      }
      case "plaintext":
        return [];
      default: {
        const name = LANGUAGE_DATA_NAME[id];
        if (!name) return [];
        return loadFromLanguageData(name);
      }
    }
  } catch {
    return [];
  }
}
