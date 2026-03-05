// src/client/sidebar/contextMenu.ts
// Context menu engine for the sidebar.

export type MenuItem = { label: string; action: () => void; danger?: boolean } | 'separator';
let _ctxMenu: HTMLElement | null = null;

export function openContextMenu(e: MouseEvent, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  for (const item of items) {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.className = `ctx-item${item.danger ? ' danger' : ''}`;
      btn.textContent = item.label;
      btn.addEventListener('mousedown', ev => ev.stopPropagation());
      btn.addEventListener('click', () => { closeContextMenu(); item.action(); });
      menu.appendChild(btn);
    }
  }
  document.body.appendChild(menu);
  _ctxMenu = menu;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX, y = e.clientY;
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;visibility:hidden`;
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (x + r.width > vw) x = vw - r.width - 4;
    if (y + r.height > vh) y = vh - r.height - 4;
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px`;
    setTimeout(() => {
      document.addEventListener('mousedown', closeContextMenu, { once: true });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeContextMenu(); }, { once: true });
    }, 0);
  });
}

export function closeContextMenu(): void {
  _ctxMenu?.remove();
  _ctxMenu = null;
}
