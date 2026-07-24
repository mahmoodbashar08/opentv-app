/**
 * Tiny hand-off so the list ⋯ menu (a modal route) can drop the list detail
 * into a mode when it dismisses. The detail reads it once on focus.
 */
export type ListMode = 'view' | 'edit' | 'reorder';

let pending: ListMode | null = null;

export function setPendingListMode(mode: ListMode): void {
  pending = mode;
}

/** Read and clear the pending mode (one-shot). */
export function takePendingListMode(): ListMode | null {
  const m = pending;
  pending = null;
  return m;
}
