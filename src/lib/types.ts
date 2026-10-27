export type DocType = "md" | "html";

export type Document = {
  id: string;
  path: string;
  type: DocType;
  content: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
};

export type DocVersion = {
  id: string;
  docId: string;
  content: string;
  path: string;
  savedAt: number;
};

export type TrashItem = {
  doc: Document;
  deletedAt: number;
};

export type PendingNav =
  | { kind: "doc"; id: string }
  | { kind: "home" }
  | null;

/** preview | split | source | mixed (Typora-like block edit for MD) */
export type ViewMode = "preview" | "split" | "source" | "mixed";

/** Reading themes — UI labels in THEME_LABELS (theme.ts). Legacy paper/ink migrate on load. */
export type ThemeMode = "bamboo" | "xuan" | "songyan" | "jiang" | "cyber";

export type StatusFeedback = {
  message: string;
  at: number;
} | null;

/** Binary attachment stored outside Document.content (IndexedDB blob). */
export type AssetMeta = {
  id: string;
  /** Vault-relative path, e.g. 笔记/assets/abc-shot.png */
  path: string;
  mime: string;
  size: number;
  createdAt: number;
  /** Optional owning doc id (hint only). */
  docId?: string;
};

/** Open editor tab (doc id). */
export type TabState = {
  openTabs: string[];
  pinnedTabs: string[];
};

/** Which pane is focused when dual-doc split is on. */
export type FocusedPane = "primary" | "secondary";
