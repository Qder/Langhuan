/**
 * Lightweight scroll-sync event bus (outside React/Zustand subscriptions).
 * Components subscribe in useEffect and drive DOM / EditorView directly,
 * so high-frequency scroll events do not re-render React trees.
 */

export type ScrollBusEvent = {
  docId: string;
  from: "preview" | "editor";
  sourceOffset?: number;
  percent?: number;
  nonce: number;
};

type Listener = (ev: ScrollBusEvent) => void;

const listeners = new Set<Listener>();

export function subscribeScrollSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishScrollBus(ev: ScrollBusEvent): void {
  for (const listener of listeners) {
    try {
      listener(ev);
    } catch {
      /* subscriber errors must not break other listeners */
    }
  }
}

/** Test helper: clear all subscribers. */
export function __resetScrollBusForTests(): void {
  listeners.clear();
}
