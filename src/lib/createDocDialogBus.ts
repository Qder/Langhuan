/** Lightweight open channel for CreateDocDialog (avoids expanding store shape). */

export type CreateDocDialogRequest = {
  type: "md" | "html";
  defaultParent: string;
  /** Prefill path/name field (e.g. command-palette create-from-query). */
  defaultName?: string;
};

type Listener = (req: CreateDocDialogRequest | null) => void;

const listeners = new Set<Listener>();

export function openCreateDocDialog(opts: {
  type: "md" | "html";
  defaultParent?: string;
  defaultName?: string;
}): void {
  const req: CreateDocDialogRequest = {
    type: opts.type,
    defaultParent: opts.defaultParent ?? "",
    defaultName: opts.defaultName,
  };
  for (const listener of listeners) listener(req);
}

export function subscribeCreateDocDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
