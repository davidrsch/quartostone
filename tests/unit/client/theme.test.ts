// @vitest-environment happy-dom
// tests/unit/client/theme.test.ts
// Unit tests for theme toggle helpers (#115).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyTheme,
  toggleTheme,
  loadStoredTheme,
  storeTheme,
  resolveInitialTheme,
} from '../../../src/client/theme.js';

function freshRoot(): HTMLElement {
  const el = document.createElement('html');
  el.className = '';
  return el;
}

function freshBtn(): HTMLButtonElement {
  return document.createElement('button');
}

beforeEach(() => {
  localStorage.clear();
});

describe('applyTheme', () => {
  it('adds .light class for light theme', () => {
    const root = freshRoot();
    applyTheme('light', root);
    expect(root.classList.contains('light')).toBe(true);
  });

  it('removes .light class for dark theme', () => {
    const root = freshRoot();
    root.classList.add('light');
    applyTheme('dark', root);
    expect(root.classList.contains('light')).toBe(false);
  });

  it('updates button text for light theme', () => {
    const root = freshRoot();
    const btn = freshBtn();
    applyTheme('light', root, btn);
    expect(btn.textContent).toBe('🌙');
  });

  it('updates button text for dark theme', () => {
    const root = freshRoot();
    const btn = freshBtn();
    applyTheme('dark', root, btn);
    // ☀ character
    expect(btn.textContent).toBe('☀');
  });

  it('sets button title for light theme', () => {
    const root = freshRoot();
    const btn = freshBtn();
    applyTheme('light', root, btn);
    expect(btn.title).toBe('Switch to dark theme');
  });

  it('works without a button argument', () => {
    // Should not throw
    const root = freshRoot();
    expect(() => applyTheme('light', root)).not.toThrow();
  });
});

describe('toggleTheme', () => {
  it('returns "dark" when root has .light class', () => {
    const root = freshRoot();
    root.classList.add('light');
    expect(toggleTheme(root)).toBe('dark');
  });

  it('returns "light" when root does not have .light class', () => {
    const root = freshRoot();
    expect(toggleTheme(root)).toBe('light');
  });
});

describe('loadStoredTheme / storeTheme', () => {
  it('returns null when nothing is stored', () => {
    expect(loadStoredTheme()).toBeNull();
  });

  it('returns the stored value after storeTheme', () => {
    storeTheme('light');
    expect(loadStoredTheme()).toBe('light');
  });

  it('returns null for invalid stored value', () => {
    localStorage.setItem('qs_theme', 'banana');
    expect(loadStoredTheme()).toBeNull();
  });
});

describe('resolveInitialTheme', () => {
  it('returns stored preference when one is set', () => {
    storeTheme('light');
    expect(resolveInitialTheme()).toBe('light');
  });

  it('falls back to dark when nothing is stored and matchMedia unavailable', () => {
    // happy-dom does not implement matchMedia; it throws or returns undefined
    const origMatchMedia = window.matchMedia;
    (window as unknown as Record<string, unknown>)['matchMedia'] = undefined;
    try {
      expect(resolveInitialTheme()).toBe('dark');
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });
});
