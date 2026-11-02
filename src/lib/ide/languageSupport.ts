import type { Extension } from "@codemirror/state";
import type { IdeLanguageId } from "./language";

/**
 * Load a CM6 language extension.
 * Java is first-class; C++ is wired as the next extension point.
 * Other ids best-effort via packages already pulled by @codemirror/language-data.
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
      case "typescript": {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ typescript: id === "typescript", jsx: true });
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
      default:
        return [];
    }
  } catch {
    return [];
  }
}
