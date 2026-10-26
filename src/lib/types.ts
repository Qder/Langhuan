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

export type ViewMode = "preview" | "split" | "source";

export type ThemeMode = "paper" | "ink";

export type StatusFeedback = {
  message: string;
  at: number;
} | null;
