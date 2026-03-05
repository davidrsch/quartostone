// tests/unit/client/cmdpalette.test.ts
// Unit tests for command palette filter helpers (#121).

import { describe, it, expect } from 'vitest';
import { filterEntries, clampIdx, moveIdx } from '../../../src/client/cmdpalette/filter.js';
import type { PaletteEntry } from '../../../src/client/cmdpalette/filter.js';

function makeEntry(label: string): PaletteEntry {
  return { icon: '📄', label, hint: '', action: () => {} };
}

const SAMPLE: PaletteEntry[] = [
  makeEntry('New page'),
  makeEntry('Save'),
  makeEntry('Commit changes'),
  makeEntry('Toggle preview'),
  makeEntry('Open graph'),
  makeEntry('Keyboard shortcuts'),
];

describe('filterEntries', () => {
  it('returns all entries for an empty query', () => {
    expect(filterEntries(SAMPLE, '')).toHaveLength(SAMPLE.length);
  });

  it('returns all entries for a whitespace-only query', () => {
    expect(filterEntries(SAMPLE, '   ')).toHaveLength(SAMPLE.length);
  });

  it('filters by case-insensitive substring match', () => {
    const result = filterEntries(SAMPLE, 'save');
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Save');
  });

  it('is case-insensitive', () => {
    const lower = filterEntries(SAMPLE, 'new');
    const upper = filterEntries(SAMPLE, 'NEW');
    expect(lower).toEqual(upper);
  });

  it('returns empty array when no entries match', () => {
    expect(filterEntries(SAMPLE, 'zzznomatch')).toHaveLength(0);
  });

  it('returns multiple matching entries', () => {
    // 'preview' matches 'Toggle preview'; 'Open graph' doesn't; test a common substring
    const result = filterEntries(SAMPLE, 'o'); // matches New page, Commit changes, Toggle preview, Open graph, Keyboard shortcuts
    expect(result.length).toBeGreaterThan(1);
  });

  it('preserves action function references on matched entries', () => {
    const action = () => {};
    const entries: PaletteEntry[] = [{ icon: '💾', label: 'Save', hint: 'Ctrl+S', action }];
    const result = filterEntries(entries, 'save');
    expect(result[0]!.action).toBe(action);
  });
});

describe('clampIdx', () => {
  it('clamps negative index to 0', () => {
    expect(clampIdx(-1, 5)).toBe(0);
  });

  it('clamps index beyond length to last index', () => {
    expect(clampIdx(10, 5)).toBe(4);
  });

  it('returns index unchanged when in range', () => {
    expect(clampIdx(2, 5)).toBe(2);
  });

  it('returns 0 when length is 0', () => {
    expect(clampIdx(0, 0)).toBe(0);
  });
});

describe('moveIdx', () => {
  it('increments index by 1', () => {
    expect(moveIdx(1, 1, 5)).toBe(2);
  });

  it('decrements index by 1', () => {
    expect(moveIdx(3, -1, 5)).toBe(2);
  });

  it('stops at 0 when decrementing from first item', () => {
    expect(moveIdx(0, -1, 5)).toBe(0);
  });

  it('stops at last index when incrementing from last item', () => {
    expect(moveIdx(4, 1, 5)).toBe(4);
  });
});
