// src/client/sidebar/recentFavorites.ts
// Favorites and Recent localStorage management, plus their list renderers.

import { STORAGE_KEYS } from '../storage.js';
import type { PageNode } from './index.js';

type SelectCallback = (path: string, name: string) => void;

// ── localStorage helpers ──────────────────────────────────────────────────────

export function getFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) ?? '[]') as string[]; }
  catch { return []; }
}
export function setFavorites(favs: string[]): void {
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(favs));
}
export function isFavorite(path: string): boolean { return getFavorites().includes(path); }
export function toggleFavorite(path: string): void {
  const favs = getFavorites();
  const i = favs.indexOf(path);
  if (i >= 0) { favs.splice(i, 1); } else { favs.push(path); }
  setFavorites(favs);
}

export function getRecent(): Array<{ path: string; name: string }> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.recent) ?? '[]') as Array<{ path: string; name: string }>; }
  catch { return []; }
}
export function addRecentPage(path: string, name: string): void {
  let recent = getRecent().filter(r => r.path !== path);
  recent.unshift({ path, name });
  recent = recent.slice(0, 10);
  localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(recent));
}

// ── Favorites / Recent list renderers ────────────────────────────────────────

export function buildSimpleList(
  nodes: PageNode[],
  onSelect: SelectCallback,
  activePath: string | null,
  iconChar: string,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'simple-list';
  for (const node of nodes) {
    const item = document.createElement('div');
    item.className = `tree-item file${activePath === node.path ? ' active' : ''}`;
    item.style.paddingLeft = '16px';
    item.tabIndex = 0;
    item.setAttribute('role', 'option');
    const icon = document.createElement('span');
    icon.className = 'icon'; icon.textContent = iconChar;
    const label = document.createElement('span');
    label.className = 'label'; label.textContent = node.name;
    item.append(icon, label);
    item.addEventListener('click', () => {
      document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      onSelect(node.path, node.name);
    });
    item.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });
    list.appendChild(item);
  }
  return list;
}

export function buildRecentList(
  recent: Array<{ path: string; name: string }>,
  onSelect: SelectCallback,
  activePath: string | null,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'simple-list';
  for (const entry of recent) {
    const item = document.createElement('div');
    item.className = `tree-item file${activePath === entry.path ? ' active' : ''}`;
    item.style.paddingLeft = '16px';
    item.tabIndex = 0;
    item.setAttribute('role', 'option');
    const icon = document.createElement('span');
    icon.className = 'icon'; icon.textContent = '↵';
    const label = document.createElement('span');
    label.className = 'label'; label.textContent = entry.name;
    item.append(icon, label);
    item.addEventListener('click', () => {
      document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      onSelect(entry.path, entry.name);
    });
    item.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });
    list.appendChild(item);
  }
  return list;
}
