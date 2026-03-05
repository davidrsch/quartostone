// @vitest-environment happy-dom
// tests/unit/client/tabbar.test.ts
// Unit tests for the TabBarManager class.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabBarManager } from '../../../src/client/tabbar/index.js';

/** Set up a <div id="tab-bar"> in the document and return it. */
function makeBar(id = 'tab-bar'): HTMLElement {
  document.body.innerHTML = `<div id="${id}"></div>`;
  return document.getElementById(id)!;
}

describe('TabBarManager', () => {
  describe('ensure()', () => {
    it('adds a tab element to the DOM bar', () => {
      const bar = makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('notes.qmd', 'Notes');
      expect(bar.querySelectorAll('.editor-tab').length).toBe(1);
    });

    it('marks the ensured tab as active (aria-selected="true")', () => {
      makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('notes.qmd', 'Notes');
      const tab = document.querySelector('[data-path="notes.qmd"]')!;
      expect(tab.getAttribute('aria-selected')).toBe('true');
    });

    it('does not duplicate a tab if ensure() is called twice for same path', () => {
      const bar = makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('notes.qmd', 'Notes');
      mgr.ensure('notes.qmd', 'Notes');
      expect(bar.querySelectorAll('.editor-tab').length).toBe(1);
    });

    it('renders multiple distinct tabs', () => {
      const bar = makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('a.qmd', 'A');
      mgr.ensure('b.qmd', 'B');
      expect(bar.querySelectorAll('.editor-tab').length).toBe(2);
    });
  });

  describe('markDirty()', () => {
    it('shows the dirty dot when dirty=true', () => {
      makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('notes.qmd', 'Notes');
      mgr.markDirty('notes.qmd', true);
      const dot = document.querySelector<HTMLElement>('.editor-tab-dot')!;
      expect(dot.style.visibility).toBe('visible');
    });

    it('hides the dirty dot when dirty=false', () => {
      makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('notes.qmd', 'Notes');
      mgr.markDirty('notes.qmd', true);
      mgr.markDirty('notes.qmd', false);
      const dot = document.querySelector<HTMLElement>('.editor-tab-dot')!;
      expect(dot.style.visibility).toBe('hidden');
    });

    it('is a no-op for an unknown path', () => {
      makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('notes.qmd', 'Notes');
      // should not throw
      expect(() => mgr.markDirty('unknown.qmd', true)).not.toThrow();
    });
  });

  describe('close()', () => {
    it('removes the tab from the DOM', () => {
      const bar = makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('a.qmd', 'A');
      mgr.close('a.qmd');
      expect(bar.querySelectorAll('.editor-tab').length).toBe(0);
    });

    it('calls onOpen with the neighbor when active tab is closed', () => {
      makeBar();
      const onOpen = vi.fn();
      const mgr = new TabBarManager('tab-bar', onOpen);
      mgr.ensure('a.qmd', 'A');
      mgr.ensure('b.qmd', 'B');
      mgr.close('b.qmd'); // b was active; neighbor is a
      expect(onOpen).toHaveBeenCalledWith('a.qmd', 'A');
    });

    it('calls onAllClosed when last tab is closed', () => {
      makeBar();
      const onAllClosed = vi.fn();
      const mgr = new TabBarManager('tab-bar', vi.fn(), onAllClosed);
      mgr.ensure('a.qmd', 'A');
      mgr.close('a.qmd');
      expect(onAllClosed).toHaveBeenCalledTimes(1);
    });

    it('does not call onOpen or onAllClosed when closing a non-active tab', () => {
      makeBar();
      const onOpen = vi.fn();
      const onAllClosed = vi.fn();
      const mgr = new TabBarManager('tab-bar', onOpen, onAllClosed);
      mgr.ensure('a.qmd', 'A');
      mgr.ensure('b.qmd', 'B'); // b is now active
      mgr.close('a.qmd');       // close non-active tab
      expect(onOpen).not.toHaveBeenCalled();
      expect(onAllClosed).not.toHaveBeenCalled();
    });

    it('is a no-op for an unknown path', () => {
      makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('a.qmd', 'A');
      expect(() => mgr.close('unknown.qmd')).not.toThrow();
    });
  });

  describe('clear()', () => {
    it('removes all tabs from the DOM after render()', () => {
      const bar = makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('a.qmd', 'A');
      mgr.ensure('b.qmd', 'B');
      mgr.clear();
      mgr.render();
      expect(bar.querySelectorAll('.editor-tab').length).toBe(0);
    });
  });

  describe('tab click', () => {
    it('calls onOpen when a non-active tab is clicked', () => {
      makeBar();
      const onOpen = vi.fn();
      const mgr = new TabBarManager('tab-bar', onOpen);
      mgr.ensure('a.qmd', 'A');
      mgr.ensure('b.qmd', 'B'); // b is active
      const aTab = document.querySelector<HTMLElement>('[data-path="a.qmd"]')!;
      aTab.click();
      expect(onOpen).toHaveBeenCalledWith('a.qmd', 'A');
    });

    it('does not call onOpen when the already-active tab is clicked', () => {
      makeBar();
      const onOpen = vi.fn();
      const mgr = new TabBarManager('tab-bar', onOpen);
      mgr.ensure('a.qmd', 'A');
      // clear mock calls from ensure()
      onOpen.mockClear();
      const aTab = document.querySelector<HTMLElement>('[data-path="a.qmd"]')!;
      aTab.click();
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('calls close() when the close button is clicked', () => {
      const bar = makeBar();
      const mgr = new TabBarManager('tab-bar', vi.fn());
      mgr.ensure('a.qmd', 'A');
      mgr.ensure('b.qmd', 'B');
      const closeBtn = document.querySelector<HTMLButtonElement>('[data-path="a.qmd"] .editor-tab-close')!;
      closeBtn.click();
      expect(bar.querySelectorAll('.editor-tab').length).toBe(1);
    });
  });
});
