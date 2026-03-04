type ToastKind = 'success' | 'error' | 'info' | 'warning';

/**
 * Shows a brief toast notification.
 * Finds or creates a #toast-container element in the document body.
 */
export function showToast(message: string, kind: ToastKind = 'info', durationMs = 3000): void {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  container.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}
