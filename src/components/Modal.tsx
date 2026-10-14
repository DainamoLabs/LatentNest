import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Progress } from './Progress';

export function Modal({
  open,
  onClose,
  dismissable = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  dismissable?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        if (!dismissable) e.preventDefault();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

/** Promise-based confirm dialog: `if (await confirm({...})) …`. Render `element` once. */
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const element = (
    <Modal open={!!state} onClose={() => close(false)}>
      {state && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(true);
          }}
        >
          <h2>{state.title}</h2>
          {state.body && <p>{state.body}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
              Cancel
            </button>
            <button autoFocus className={state.danger ? 'btn btn-danger' : 'btn btn-primary'}>
              {state.confirmLabel ?? 'OK'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
  return [confirm, element] as const;
}

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  /** Accept an empty answer (resolves to ''). */
  allowEmpty?: boolean;
}

/** Promise-based single-field prompt; resolves to null on cancel. */
export function usePrompt() {
  const [state, setState] = useState<(PromptOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [value, setValue] = useState('');
  const hintId = useId();
  const prompt = useCallback((options: PromptOptions) => {
    setValue(options.initial ?? '');
    return new Promise<string | null>((resolve) => setState({ ...options, resolve }));
  }, []);
  const close = (v: string | null) => {
    state?.resolve(v);
    setState(null);
  };
  const element = (
    <Modal open={!!state} onClose={() => close(null)}>
      {state && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() || state.allowEmpty) close(value.trim());
          }}
        >
          <h2>{state.title}</h2>
          <div className="field">
            <label className="field">
              <span className="field-label">{state.label}</span>
              <input
                className="input"
                autoFocus
                maxLength={state.maxLength ?? 80}
                placeholder={state.placeholder}
                aria-describedby={state.hint ? hintId : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </label>
            {state.hint && (
              <span className="field-hint" id={hintId}>
                {state.hint}
              </span>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => close(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!value.trim() && !state.allowEmpty}>
              {state.confirmLabel ?? 'Save'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
  return [prompt, element] as const;
}

export function BusyModal({ busy }: { busy: { title: string; done: number; total: number } | null }) {
  return (
    <Modal open={!!busy} dismissable={false} onClose={() => {}}>
      {busy && (
        <form onSubmit={(e) => e.preventDefault()}>
          <h2>{busy.title}</h2>
          <Progress value={busy.done} max={busy.total} label={busy.title} />
          <p>{busy.total ? `${busy.done} of ${busy.total}` : 'Preparing…'}</p>
        </form>
      )}
    </Modal>
  );
}
