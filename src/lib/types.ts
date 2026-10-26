export type DocKind = "md" | "html";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

export interface DocMeta {
  path: string;
  name: string;
  kind: DocKind | string;
  title: string;
  tags: string[];
  body: string;
}
