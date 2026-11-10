/** Top-bar / touch 「批注」asks the open preview reader to annotate the selection. */

export const ANNOTATE_SELECTION_EVENT = "lh:annotate-selection";

export function requestAnnotateSelection(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ANNOTATE_SELECTION_EVENT));
}
