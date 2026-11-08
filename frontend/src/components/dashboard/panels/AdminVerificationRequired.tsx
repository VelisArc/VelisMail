import { CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, X, KeyRound, MailCheck } from 'lucide-react';
import type { User } from '../../../api/client';

interface AdminVerificationRequiredProps {
  user: User | null;
  onClose: () => void;
  onGoToSettings: () => void;
}

/**
 * Platform admin access notice.
 *
 * Platform admin routes are locked until the complete verification process is
 * done: a verified recovery email and authenticator 2FA. The moment any item
 * becomes unverified (for example if 2FA is disabled), admin access drops
 * automatically and this notice comes back.
 */
export default function AdminVerificationRequired({ user, onClose, onGoToSettings }: AdminVerificationRequiredProps) {
  const recoveryEmail = user?.recoveryEmail?.trim();
  const recoveryDone = Boolean(user?.recoveryEmailVerified);
  const mfaDone = Boolean(user?.totpEnabled);
  const allDone = recoveryDone && mfaDone;

  const steps = [
    {
      icon: MailCheck,
      title: 'Verify your recovery email',
      detail: recoveryEmail
        ? `We'll email a code to ${maskEmail(recoveryEmail)}. Confirm it with the OTP to unlock.`
        : 'Add a recovery email and confirm the OTP we send you.',
      done: recoveryDone,
      cta: 'Verify email in Settings → Security',
    },
    {
      icon: KeyRound,
      title: 'Set up authenticator 2FA',
      detail: 'Scan the QR code in an authenticator app and enter the 6-digit code.',
      done: mfaDone,
      cta: 'Set up app in Settings → Security',
    },
  ];

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="glass-card animate-scale"
        style={{ maxWidth: '520px', width: '100%', padding: '24px', position: 'relative' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Admin access is locked"
      >
        <button
          type="button"
          className="modal-close-btn"
          style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 0, padding: 6, borderRadius: 8, cursor: 'pointer', color: 'inherit' }}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div className="login-icon-wrap" aria-hidden="true">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h3 style={{ margin: '4px 0 6px' }}>Admin access is locked</h3>
            <p className="login-card-desc" style={{ margin: 0 }}>
              Your platform admin permission is reserved for a fully verified operator account.
              Finish the two steps below and the panel unlocks automatically — no re-invite required.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
                  padding: '12px 14px', marginBottom: 10,
                }}
              >
                <div style={{ marginTop: 2 }} aria-hidden="true">
                  {step.done
                    ? <CheckCircle2 size={20} color="var(--success, #22c55e)" />
                    : <Icon size={20} color="var(--warning, #f59e0b)" />}
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ display: 'block', marginBottom: 2 }}>{step.title}</strong>
                  <span className="login-card-desc" style={{ display: 'block' }}>{step.detail}</span>
                  {!step.done && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 8 }}
                      onClick={onGoToSettings}
                    >
                      {step.cta} <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="settings-spacer-sm"
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '10px 12px', borderRadius: 10,
            border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)',
          }}
        >
          <AlertTriangle size={16} color="var(--warning, #f59e0b)" style={{ marginTop: 2 }} />
          <p className="login-card-desc" style={{ margin: 0 }}>
            Agar yahan kuch bhi baad me missing ho jaye — recovery email unverified ho, 2FA band ho —
            toh admin access turant revoke ho jayega aur panel phir nahi khulega, jab tak aap ye
            complete verification dobara complete na kar lein.
          </p>
        </div>

        {allDone && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, color: 'var(--success, #22c55e)' }}>
            <CheckCircle2 size={16} />
            <span><strong>Verification complete.</strong> Press “Done” or switch views and the panel will load.</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onGoToSettings}>
            Open Security settings <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return email;
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}
