/**
 * Map a project-relative path to an IDE language id (status + CM6 support).
 * Extension point: add an id here, map extensions/basenames, then wire
 * `languageSupportFor` (direct package or `@codemirror/language-data`).
 */
export type IdeLanguageId =
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "json"
  | "markdown"
  | "html"
  | "css"
  | "scss"
  | "sass"
  | "less"
  | "xml"
  | "yaml"
  | "toml"
  | "python"
  | "rust"
  | "go"
  | "php"
  | "sql"
  | "ruby"
  | "kotlin"
  | "swift"
  | "scala"
  | "lua"
  | "shell"
  | "powershell"
  | "dockerfile"
  | "vue"
  | "dart"
  | "haskell"
  | "r"
  | "perl"
  | "clojure"
  | "protobuf"
  | "groovy"
  | "cmake"
  | "properties"
  | "plaintext";

/** Basename (no directory) → language id for extensionless / special names. */
const BASENAME_LANGUAGE: Record<string, IdeLanguageId> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "shell",
  gnumakefile: "shell",
  jenkinsfile: "groovy",
};

const EXTENSION_LANGUAGE: Record<string, IdeLanguageId> = {
  java: "java",
  c: "c",
  h: "c",
  ino: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  "h++": "cpp",
  cs: "csharp",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  json5: "json",
  map: "json",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  mkd: "markdown",
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  xml: "xml",
  xsl: "xml",
  xsd: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  py: "python",
  pyw: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  php: "php",
  php3: "php",
  php4: "php",
  php5: "php",
  php7: "php",
  phtml: "php",
  sql: "sql",
  rb: "ruby",
  rake: "ruby",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  scala: "scala",
  sc: "scala",
  lua: "lua",
  sh: "shell",
  bash: "shell",
  ksh: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",
  vue: "vue",
  dart: "dart",
  hs: "haskell",
  lhs: "haskell",
  r: "r",
  pl: "perl",
  pm: "perl",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  proto: "protobuf",
  groovy: "groovy",
  gradle: "groovy",
  cmake: "cmake",
  properties: "properties",
  ini: "properties",
  conf: "properties",
  cfg: "properties",
};

export function languageIdFromPath(path: string): IdeLanguageId {
  const base = path.replace(/\\/g, "/").split("/").pop() || path;
  const lowerBase = base.toLowerCase();

  const byName = BASENAME_LANGUAGE[lowerBase];
  if (byName) return byName;

  const dot = lowerBase.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  const ext = lowerBase.slice(dot + 1);
  return EXTENSION_LANGUAGE[ext] ?? "plaintext";
}
