import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Database, Globe, KeyRound, Mail } from 'lucide-react';
import type { User } from '../../api/client';

interface SetupRequiredProps {
  user: User | null;
}

type SetupItem = {
  key: string;
  label: string;
  description: string;
  icon: typeof Database;
  done: boolean;
};

/**
 * Shown while the workspace is not fully configured.
 *
 * Nothing in the product works before the infrastructure is in place, so the
 * dashboard explains exactly what is missing, what it unlocks and takes the
 * user straight into the setup flow.
 */
export default function SetupRequired({ user }: SetupRequiredProps) {
  const navigate = useNavigate();

  const items: SetupItem[] = [
    {
      key: 'database',
      label: 'Business database',
      description: 'The PostgreSQL database that stores your mail, domains and team.',
      icon: Database,
      done: Boolean(user?.businessDbUrl?.trim()),
    },
    {
      key: 'apiKey',
      label: 'Mail API key',
      description: 'Your sending credential. Every plan starts with a free trial allowance.',
      icon: KeyRound,
      done: Boolean(user?.businessApiKey?.trim()),
    },
    {
      key: 'domain',
      label: 'Primary domain',
      description: 'The domain your company sends from. It has to be verified.',
      icon: Globe,
      done: Boolean(user?.businessDomain?.trim()),
    },
    {
      key: 'provider',
      label: 'Mail provider',
      description: 'VelisMail delivery or your own provider for transactional mail.',
      icon: Mail,
      done: Boolean(user?.businessMailProvider?.trim()),
    },
  ];

  const completed = items.filter((item) => item.done).length;
  const progress = Math.round((completed / items.length) * 100);

  return (
    <div className="setup-required">
      <div className="setup-required-card glass-card">
        <span className="setup-required-eyebrow">
          <AlertTriangle size={14} /> Setup required
        </span>
        <h1>Finish setting up your workspace</h1>
        <p className="text-sm text-muted">
          Your workspace needs a database, a mail API key, a verified domain and a mail provider before
          any feature can be used. Two minutes of setup unlocks the whole product.
        </p>

        <div className="setup-progress">
          <div className="setup-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-muted">{completed} of {items.length} complete</span>
        </div>

        <ul className="setup-list">
          {items.map((item) => (
            <li key={item.key} className={`setup-item ${item.done ? 'done' : ''}`}>
              <span className="setup-item-icon">
                {item.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              </span>
              <span className="setup-item-icon-alt"><item.icon size={16} /></span>
              <span className="setup-item-copy">
                <strong>{item.label}</strong>
                <span className="text-xs text-muted">{item.description}</span>
              </span>
              <span className={`badge badge-${item.done ? 'success' : 'neutral'}`}>
                {item.done ? 'ready' : 'missing'}
              </span>
            </li>
          ))}
        </ul>

        <div className="setup-actions">
          <button className="btn btn-primary" onClick={() => navigate('/business-setup')}>
            Continue setup <ArrowRight size={14} />
          </button>
          <span className="text-xs text-muted">
            Signed in as {user?.email}
          </span>
        </div>
      </div>
    </div>
  );
}
