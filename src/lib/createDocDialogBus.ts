/** Lightweight open channel for CreateDocDialog (avoids expanding store shape). */

export type CreateDocDialogRequest = {
  type: "md" | "html";
  defaultParent: string;
  /** Prefill path/name field (e.g. command-palette create-from-query). */
  defaultName?: string;
};

type Listener = (req: CreateDocDialogRequest | null) => void;

const listeners = new Set<Listener>();

/**
 * Requests made while no host is mounted (e.g. from 读码, where the notes shell
 * — and therefore `CreateDocDialogHost` — is unmounted) are held here and
 * delivered to the next host that subscribes.
 */
let pending: CreateDocDialogRequest | null = null;

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
  if (listeners.size === 0) {
    pending = req;
    return;
  }
  for (const listener of listeners) listener(req);
}

export function subscribeCreateDocDialog(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const held = pending;
    pending = null;
    listener(held);
  }
  return () => {
    listeners.delete(listener);
  };
}
