import { useSyncExternalStore } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, options: { kind?: Toast['kind']; action?: Toast['action']; duration?: number } = {}) {
  const t: Toast = { id: nextId++, message, kind: options.kind ?? 'info', action: options.action };
  toasts = [...toasts.slice(-2), t];
  emit();
  const duration = options.duration ?? (t.action || t.kind === 'error' ? 7000 : 3500);
  setTimeout(() => dismiss(t.id), duration);
}

export const toastError = (err: unknown, action?: Toast['action']) =>
  toast(err instanceof Error ? err.message : String(err), { kind: 'error', action });

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
