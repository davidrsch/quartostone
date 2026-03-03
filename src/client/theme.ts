// src/client/theme.ts
// Light/dark theme helpers — extracted for unit testing (#115).

export type Theme = 'dark' | 'light';

const THEME_KEY = 'qs_theme';

/** Apply a theme to the document root. Updates the button text/title if provided. */
export function applyTheme(
  t: Theme,
  root: HTMLElement = document.documentElement,
  btn?: HTMLButtonElement | null,
): void {
  root.classList.toggle('light', t === 'light');
  if (btn) {
    btn.textContent  = t === 'light' ? '🌙' : '☀';
    btn.title        = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    btn.setAttribute('aria-label', btn.title);
  }
}

/** Toggle between light and dark, returning the new theme. */
export function toggleTheme(root: HTMLElement = document.documentElement): Theme {
  return root.classList.contains('light') ? 'dark' : 'light';
}

/** Read the persisted theme. Returns null if nothing stored. */
export function loadStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return (v === 'light' || v === 'dark') ? v : null;
  } catch {
    return null;
  }
}

/** Persist the chosen theme. */
export function storeTheme(t: Theme): void {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
}

/** Determine the initial theme: stored pref → OS pref → dark. */
export function resolveInitialTheme(): Theme {
  const stored = loadStoredTheme();
  if (stored) return stored;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
