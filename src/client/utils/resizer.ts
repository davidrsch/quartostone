// src/client/utils/resizer.ts
// Shared drag-to-resize helper. Used by main.ts (sidebar + pane divider) and preview/index.ts.
// NOTE: existing implementations in those files are left in place; this utility is available
// for new code and future refactoring (Q28).

export interface ResizerOptions {
  handle: HTMLElement;
  getInitialSize: (startX: number) => number;
  onResize: (newSize: number) => void;
  minSize?: number;
  maxSize?: number;
}

export function makeResizer(opts: ResizerOptions): () => void {
  function onMouseDown(e: MouseEvent) {
    const startX = e.clientX;
    const startSize = opts.getInitialSize(startX);
    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      const newSize = Math.max(opts.minSize ?? 0, Math.min(opts.maxSize ?? Infinity, startSize + delta));
      opts.onResize(newSize);
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
  opts.handle.addEventListener('mousedown', onMouseDown);
  return () => opts.handle.removeEventListener('mousedown', onMouseDown);
}
