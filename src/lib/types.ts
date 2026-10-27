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

export type ViewMode = "preview" | "split" | "source";

export type ThemeMode = "paper" | "ink";

export type StatusFeedback = {
  message: string;
  at: number;
} | null;
