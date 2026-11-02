/** Default directory / file names skipped when walking an IDE project tree. */
export const IDE_IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "target",
  "build",
  "dist",
  "out",
  ".idea",
  ".vscode",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".gradle",
  ".mvn",
  "vendor",
  "coverage",
  ".DS_Store",
  "Thumbs.db",
]);

export function shouldIgnoreName(name: string): boolean {
  if (!name) return true;
  if (IDE_IGNORED_NAMES.has(name)) return true;
  // Skip other dotfolders except common source-ish ones
  if (name.startsWith(".") && name !== ".env" && name !== ".gitignore") {
    // allow listing .env / .gitignore as files; hide other dot dirs/files by default
    if (name === ".env" || name === ".gitignore" || name === ".editorconfig") return false;
    return true;
  }
  return false;
}
