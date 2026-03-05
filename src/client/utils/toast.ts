export type ToastKind = 'success' | 'error' | 'info' | 'warning';

/**
 * Shows a brief toast notification.
 * CSS classes: `toast <kind>` — matches style.css rules (.toast.success, .toast.error, .toast.info).
 */
export function showToast(message: string, kind: ToastKind = 'info', duration = 3500): void {
  const container = document.getElementById('toast-container') ?? document.body;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
