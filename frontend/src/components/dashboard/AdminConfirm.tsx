import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldQuestion } from 'lucide-react';

/**
 * A pending administrator action that still needs an explicit confirmation.
 *
 * Every state-changing action in the control plane and the company console
 * goes through this dialog: the first click only *proposes* the action, the
 * operator has to confirm it a second time before anything is sent to the
 * API. That keeps a stray click from suspending a company, revoking a key or
 * changing a role.
 */
export type AdminConfirmRequest = {
  /** Short headline, for example "Suspend company". */
  title: string;
  /** Exactly what is going to happen once confirmed. */
  message: string;
  /** Label of the confirming button. */
  confirmLabel?: string;
  /** Destructive actions use the red treatment. */
  tone?: 'danger' | 'primary';
  /** Runs only after the operator confirms. */
  onConfirm: () => void | Promise<void>;
  /** Runs when the operator backs out. */
  onCancel?: () => void;
};

export type AdminConfirmDialogProps = {
  request: AdminConfirmRequest | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AdminConfirmDialog({ request, busy, onCancel, onConfirm }: AdminConfirmDialogProps) {
  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, busy, onCancel]);

  if (!request) return null;

  const danger = (request.tone ?? 'danger') === 'danger';

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel} role="dialog" aria-modal="true" aria-label={request.title}>
      <div className="biz-form-modal glass animate-scale confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-body-center">
          <div className="modal-icon-danger">
            {danger ? <AlertTriangle size={24} /> : <ShieldQuestion size={24} />}
          </div>
          <h3 className="confirm-title">{request.title}</h3>
          <p className="text-sm text-muted">{request.message}</p>
        </div>
        <div className="modal-actions-border">
          <button type="button" className="btn btn-ghost confirm-btn-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-btn-confirm`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working...' : (request.confirmLabel ?? 'Yes, Continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

export type AdminConfirmSelectProps = {
  /** The value that is currently persisted. */
  value: string;
  options: Array<string | { value: string; label?: string }>;
  /** The shared confirmation opener of the panel. */
  confirm: (request: AdminConfirmRequest) => void;
  /** Headline for the proposed change. */
  title: (next: string) => string;
  /** What the change does once confirmed. */
  message: (next: string) => string;
  /** Label of the confirm button. It may depend on the selected value. */
  confirmLabel?: string | ((next: string) => string);
  /** Tone of the confirm button. It may depend on the selected value. */
  tone?: 'danger' | 'primary' | ((next: string) => 'danger' | 'primary');
  /** Runs only after the operator confirmed the change. */
  onApply: (next: string) => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

/**
 * A `<select>` that only applies its value after the operator confirmed it.
 *
 * The pending value stays visible while the confirmation dialog is open and
 * is discarded when the operator backs out, so the stored value never changes
 * by accident.
 */
export function AdminConfirmSelect({
  value,
  options,
  confirm,
  title,
  message,
  confirmLabel,
  tone,
  onApply,
  className,
  disabled,
  ariaLabel,
}: AdminConfirmSelectProps) {
  const [pending, setPending] = useState<string | null>(null);
  const normalised = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );

  return (
    <select
      className={className ?? 'input input-auto'}
      value={pending ?? value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => {
        const next = event.target.value;
        if (next === value) {
          setPending(null);
          return;
        }
        setPending(next);
        confirm({
          title: title(next),
          message: message(next),
          confirmLabel:
            typeof confirmLabel === 'function' ? confirmLabel(next) : confirmLabel,
          tone: typeof tone === 'function' ? tone(next) : tone,
          onConfirm: async () => {
            try {
              await onApply(next);
            } finally {
              setPending(null);
            }
          },
          onCancel: () => setPending(null),
        });
      }}
    >
      {normalised.map((option) => (
        <option key={option.value} value={option.value}>{option.label ?? option.value}</option>
      ))}
    </select>
  );
}
