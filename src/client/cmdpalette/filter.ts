// src/client/cmdpalette/filter.ts
// Pure filtering and scoring helpers for the command palette (#113).
// Exported for unit testing.

export interface PaletteEntry {
  icon:   string;
  label:  string;
  hint:   string;
  action: () => void;
}

/**
 * Filter a list of palette entries by a search query.
 * Empty query returns all entries.
 * Matching is case-insensitive substring on the label.
 */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  if (!query.trim()) return entries;
  const lower = query.toLowerCase();
  return entries.filter(e => e.label.toLowerCase().includes(lower));
}

/**
 * Clamp an index into the valid range [0, length-1].
 * Returns the original index unchanged when the list is empty.
 */
export function clampIdx(idx: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(length - 1, idx));
}

/**
 * Wrap-around index movement (+1 / -1) that stays within bounds (no wrap).
 */
export function moveIdx(current: number, delta: 1 | -1, length: number): number {
  return clampIdx(current + delta, length);
}
