// src/client/keyboard.ts
// Global keyboard shortcut registration for the quartostone editor.

import { isDirty, activePath, editorMode } from './state/editorState.js';

export type KeyboardShortcutOptions = {
  hasActiveDb(): boolean;
  saveCurrentPage(): Promise<void>;
  openCommitDialog(defaultMsg?: string): void;
  makeAutoSlug(): string;
  switchMode(mode: 'source' | 'visual'): Promise<void>;
  searchOpen(): void;
  openCmdPalette(): void;
  closeCmdPalette(): void;
  toggleSplit(): void;
};

/**
 * Register global keyboard shortcuts.
 * Uses AbortController so all listeners are cleaned up on `beforeunload`.
 */
export function registerKeyboardShortcuts(opts: KeyboardShortcutOptions): void {
  const kbdController = new AbortController();
  window.addEventListener('beforeunload', () => kbdController.abort(), { once: true });

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;

    // Ctrl+S — save and commit
    if (mod && e.key === 's') {
      e.preventDefault();
      document.getElementById('btn-save')?.click();
    }
    // Ctrl+Shift+G — fallback for commit dialog
    if (mod && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      document.getElementById('btn-save')?.click();
    }
    // Ctrl+Shift+E — toggle visual/source editor mode
    if (mod && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      if (activePath && !opts.hasActiveDb()) {
        void opts.switchMode(editorMode === 'visual' ? 'source' : 'visual');
      }
    }

    // Ctrl+P — search pages overlay
    if (mod && !e.shiftKey && e.key === 'p') {
      e.preventDefault();
      opts.searchOpen();
    }
    // Ctrl+K — command palette (#113)
    if (mod && e.key === 'k') {
      e.preventDefault();
      opts.openCmdPalette();
    }
    // Ctrl+\ — toggle split editor (#140)
    if (mod && e.key === '\\') {
      e.preventDefault();
      opts.toggleSplit();
    }

    // Escape — close command palette if open
    if (e.key === 'Escape') {
      if (!document.getElementById('cmd-palette')!.classList.contains('hidden')) {
        opts.closeCmdPalette();
      }
    }
  }, { signal: kbdController.signal });
}
