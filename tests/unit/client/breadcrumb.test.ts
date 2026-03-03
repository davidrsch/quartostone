// @vitest-environment happy-dom
// tests/unit/client/breadcrumb.test.ts
// Unit tests for breadcrumb navigation (#139).

import { describe, it, expect, vi } from 'vitest';
import { renderBreadcrumb } from '../../../src/client/breadcrumb.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  const el = document.createElement('nav');
  el.id = 'editor-breadcrumb';
  el.className = 'hidden';
  return el;
}

/** Collect the text of all `.bc-seg` spans inside `el`. */
function segments(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll<HTMLElement>('.bc-seg')).map(s => s.textContent ?? '');
}

/** Collect the text of all `.bc-sep` spans inside `el`. */
function separators(el: HTMLElement): number {
  return el.querySelectorAll('.bc-sep').length;
}

// ── null / empty path ─────────────────────────────────────────────────────────

describe('renderBreadcrumb — null path', () => {
  it('adds "hidden" class when path is null', () => {
    const el = makeContainer();
    el.classList.remove('hidden');
    renderBreadcrumb(null, el);
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('clears existing content when path is null', () => {
    const el = makeContainer();
    el.innerHTML = '<span>old</span>';
    renderBreadcrumb(null, el);
    expect(el.innerHTML).toBe('');
  });
});

// ── single-segment path ───────────────────────────────────────────────────────

describe('renderBreadcrumb — single segment', () => {
  it('removes "hidden" when path is provided', () => {
    const el = makeContainer();
    renderBreadcrumb('intro.qmd', el);
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('renders one segment for a root-level file', () => {
    const el = makeContainer();
    renderBreadcrumb('intro.qmd', el);
    expect(segments(el)).toEqual(['intro']);
  });

  it('strips .qmd extension (case-insensitive)', () => {
    const el = makeContainer();
    renderBreadcrumb('README.QMD', el);
    expect(segments(el)).toEqual(['README']);
  });

  it('marks the single segment as bc-current', () => {
    const el = makeContainer();
    renderBreadcrumb('intro.qmd', el);
    const seg = el.querySelector('.bc-seg');
    expect(seg?.classList.contains('bc-current')).toBe(true);
  });

  it('sets aria-current="page" on the single segment', () => {
    const el = makeContainer();
    renderBreadcrumb('intro.qmd', el);
    const seg = el.querySelector('.bc-seg');
    expect(seg?.getAttribute('aria-current')).toBe('page');
  });

  it('renders no separators for a root-level file', () => {
    const el = makeContainer();
    renderBreadcrumb('intro.qmd', el);
    expect(separators(el)).toBe(0);
  });
});

// ── multi-segment paths ───────────────────────────────────────────────────────

describe('renderBreadcrumb — nested path', () => {
  it('renders segment labels for pages/section/file.qmd', () => {
    const el = makeContainer();
    renderBreadcrumb('pages/section/file.qmd', el);
    expect(segments(el)).toEqual(['pages', 'section', 'file']);
  });

  it('inserts separators between segments (n-1)', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b/c.qmd', el);
    expect(separators(el)).toBe(2);
  });

  it('marks only the last segment as bc-current', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b/c.qmd', el);
    const segs = Array.from(el.querySelectorAll<HTMLElement>('.bc-seg'));
    const current = segs.filter(s => s.classList.contains('bc-current'));
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe('c');
  });

  it('sets aria-current="false" on non-current segments', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b/c.qmd', el);
    const segs = Array.from(el.querySelectorAll<HTMLElement>('.bc-seg:not(.bc-current)'));
    segs.forEach(s => expect(s.getAttribute('aria-current')).toBe('false'));
  });

  it('title attribute on each segment equals the cumulative path', () => {
    const el = makeContainer();
    renderBreadcrumb('notes/research/intro.qmd', el);
    const segs = Array.from(el.querySelectorAll<HTMLElement>('.bc-seg'));
    expect(segs[0].title).toBe('notes');
    expect(segs[1].title).toBe('notes/research');
    expect(segs[2].title).toBe('notes/research/intro');
  });
});

// ── separator markup ──────────────────────────────────────────────────────────

describe('renderBreadcrumb — separator elements', () => {
  it('separators have aria-hidden="true"', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b.qmd', el);
    const seps = Array.from(el.querySelectorAll('.bc-sep'));
    seps.forEach(s => expect(s.getAttribute('aria-hidden')).toBe('true'));
  });

  it('separator text content is "/"', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b.qmd', el);
    const sep = el.querySelector('.bc-sep');
    expect(sep?.textContent).toBe('/');
  });
});

// ── onFolderClick callback ────────────────────────────────────────────────────

describe('renderBreadcrumb — onFolderClick', () => {
  it('fires callback with cumulative path when a folder segment is clicked', () => {
    const el = makeContainer();
    const onClick = vi.fn();
    renderBreadcrumb('notes/research/intro.qmd', el, onClick);

    const segs = Array.from(el.querySelectorAll<HTMLElement>('.bc-seg:not(.bc-current)'));
    // Click "notes" (index 0)
    segs[0].click();
    expect(onClick).toHaveBeenCalledWith('notes');
    // Click "research" (index 1)
    segs[1].click();
    expect(onClick).toHaveBeenCalledWith('notes/research');
  });

  it('does not fire callback when the current (last) segment is clicked', () => {
    const el = makeContainer();
    const onClick = vi.fn();
    renderBreadcrumb('a/b/c.qmd', el, onClick);
    const current = el.querySelector<HTMLElement>('.bc-current')!;
    current.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('works without onFolderClick (no callback provided)', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b.qmd', el);
    const seg = el.querySelector<HTMLElement>('.bc-seg:not(.bc-current)')!;
    // Should not throw when clicked without a callback
    expect(() => seg.click()).not.toThrow();
  });
});

// ── re-render replaces previous content ──────────────────────────────────────

describe('renderBreadcrumb — re-render', () => {
  it('replaces content on subsequent calls', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b.qmd', el);
    renderBreadcrumb('x/y/z.qmd', el);
    expect(segments(el)).toEqual(['x', 'y', 'z']);
  });

  it('clears and hides when null follows a valid path', () => {
    const el = makeContainer();
    renderBreadcrumb('a/b.qmd', el);
    renderBreadcrumb(null, el);
    expect(el.children).toHaveLength(0);
    expect(el.classList.contains('hidden')).toBe(true);
  });
});
