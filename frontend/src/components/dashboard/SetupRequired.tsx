import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, Copy, Crown, RefreshCw, X } from 'lucide-react';
import type { User } from '../../api/client';
import useWorkspaceReadiness from './useWorkspaceReadiness';

interface SetupRequiredProps {
  user: User | null;
  /** The platform owner can still open the control plane. */
  canOpenControlPlane?: boolean;
  onOpenControlPlane?: () => void;
}

/**
 * Shown while the workspace is not fully configured.
 *
 * Nothing in the product works before the infrastructure is in place, so the
 * dashboard stays closed until every item is green. The panel is small and
 * sits in the corner of the screen: it names every missing step, shows the
 * DNS records that still have to be published - with the name and the value -
 * and takes the user straight into the setup.
 */
export default function SetupRequired({ user, canOpenControlPlane, onOpenControlPlane }: SetupRequiredProps) {
  const navigate = useNavigate();
  const readiness = useWorkspaceReadiness(user);
  const { checks, pending, error, loading } = readiness;

  const completed = checks.filter((check) => check.done).length;
  const progress = checks.length ? Math.round((completed / checks.length) * 100) : 0;

  const copy = (value: string) => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
  };

  return (
    <div className="setup-required">
      <section className="setup-required-card">
        <header className="setup-required-head">
          <span className="setup-required-eyebrow">
            <AlertTriangle size={13} /> Setup required
          </span>
          <h1>Complete your setup</h1>
          <p className="setup-required-lead">
            The dashboard opens when every step below is done. Right now {completed} of{' '}
            {checks.length} steps are finished.
          </p>
        </header>

        <div className="setup-progress">
          <div className="setup-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="setup-progress-label">{progress}%</span>
        </div>

        {error && (
          <p className="setup-error">
            <AlertTriangle size={13} /> {error} Complete the setup and check again.
          </p>
        )}

        <ul className="setup-list">
          {checks.map((check) => {
            const Icon = check.icon;
            return (
              <li key={check.key} className={`setup-item ${check.done ? 'done' : ''}`}>
                <span className="setup-item-state">
                  {check.done ? <Check size={14} /> : <X size={14} />}
                </span>
                <span className="setup-item-copy">
                  <strong>
                    <Icon size={13} /> {check.label}
                  </strong>
                  <span className="setup-item-detail">{check.detail}</span>
                </span>
                <span className={`setup-item-badge ${check.done ? 'ok' : 'todo'}`}>
                  {check.done ? 'done' : 'missing'}
                </span>
              </li>
            );
          })}
        </ul>

        {pending.length > 0 && (
          <div className="setup-records">
            <span className="setup-records-title">Records to publish</span>
            {pending.map((record) => (
              <div key={`${record.recordType}-${record.name}`} className="setup-record">
                <div className="setup-record-head">
                  <span className="setup-record-type">
                    {record.recordType} &middot; <code>{record.name}</code>
                  </span>
                  <button
                    type="button"
                    className="setup-record-copy"
                    onClick={() => copy(record.value)}
                    disabled={!record.value}
                    title="Copy value"
                  >
                    <Copy size={12} />
                  </button>
                </div>
                {record.value && <code className="setup-record-value">{record.value}</code>}
                {record.detail && <p className="setup-record-detail">{record.detail}</p>}
                {record.actual && record.status !== 'verified' && (
                  <p className="setup-record-current">Published now: {record.actual}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <footer className="setup-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/business-setup')}
            disabled={loading}
          >
            Complete the setup <ArrowRight size={14} />
          </button>
          <button type="button" className="btn btn-ghost" onClick={readiness.reload} disabled={loading}>
            <RefreshCw size={13} /> {loading ? 'Checking...' : 'Re-check'}
          </button>
          {canOpenControlPlane && onOpenControlPlane && (
            <button type="button" className="btn btn-ghost" onClick={onOpenControlPlane}>
              <Crown size={13} /> Control Plane
            </button>
          )}
        </footer>

        <p className="setup-signed-in">Signed in as {user?.email}</p>
      </section>
    </div>
  );
}
