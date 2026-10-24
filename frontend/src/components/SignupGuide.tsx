import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Database,
  Globe,
  Inbox,
  KeyRound,
  Mail,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Webhook,
} from 'lucide-react';
import './SignupGuide.css';

interface SignupGuideProps {
  /** Open the registration form. */
  onComplete: () => void;
  /** Skip the guide and open the registration form. */
  onSkip: () => void;
}

const STEPS = [
  { key: 'account', label: 'Account', icon: Sparkles },
  { key: 'database', label: 'Database', icon: Database },
  { key: 'provider', label: 'Mail provider', icon: KeyRound },
  { key: 'dns', label: 'Domain & DNS', icon: Globe },
  { key: 'verify', label: 'Go live', icon: ShieldCheck },
] as const;

/**
 * A short, practical walkthrough shown before registration.
 *
 * It is written as a setup guide - what you will do, why, and how long it
 * takes - rather than a policy. Every step can be skipped and revisited from
 * the dashboard setup page, so nothing here is a wall of text.
 */
export default function SignupGuide({ onComplete, onSkip }: SignupGuideProps) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const next = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setIndex((value) => Math.min(value + 1, STEPS.length - 1));
  };

  const previous = () => setIndex((value) => Math.max(value - 1, 0));

  return (
    <div className="setup-guide-backdrop">
      <section
        ref={dialogRef}
        className="setup-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-guide-title"
        tabIndex={-1}
      >
        <header className="setup-guide-head">
          <div className="setup-guide-brand">
            <span className="setup-guide-mark"><Mail size={18} /></span>
            <div>
              <span className="setup-guide-eyebrow">Quick start guide</span>
              <h2 id="setup-guide-title">Set up VelisMail in 5 steps</h2>
            </div>
          </div>
          <button type="button" className="setup-guide-skip" onClick={onSkip}>
            Skip guide
          </button>
        </header>

        <div className="setup-guide-progress">
          <div
            className="setup-guide-dots"
            role="tablist"
            aria-label={`Step ${index + 1} of ${STEPS.length}`}
          >
            {STEPS.map((entry, entryIndex) => {
              const done = entryIndex < index;
              const active = entryIndex === index;
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`Step ${entryIndex + 1}: ${entry.label}`}
                  aria-current={active ? 'step' : undefined}
                  className={`setup-guide-dot ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}
                  onClick={() => setIndex(entryIndex)}
                >
                  <span className="setup-guide-dot-index">
                    {done ? <Check size={12} /> : entryIndex + 1}
                  </span>
                  <span className="setup-guide-dot-label">{entry.label}</span>
                </button>
              );
            })}
          </div>
          <span className="setup-guide-count">{index + 1} of {STEPS.length}</span>
        </div>

        <div className="setup-guide-body">
          <div className="setup-guide-step-head">
            <span className="setup-guide-icon">
              <step.icon size={20} />
            </span>
            <div>
              <span className="setup-guide-kicker">Step {index + 1} · {step.label}</span>
              <h3>{STEP_TITLES[index]}</h3>
              <p>{STEP_LEADS[index]}</p>
            </div>
          </div>

          {index === 0 && (
            <>
              <div className="setup-guide-need">
                <span className="setup-guide-label">Before you start, keep these ready</span>
                <div className="setup-guide-need-grid">
                  <div className="setup-guide-need-card">
                    <Globe size={16} />
                    <div>
                      <strong>A domain you own</strong>
                      <small>Namecheap, GoDaddy, Cloudflare, Porkbun — any registrar works.</small>
                    </div>
                  </div>
                  <div className="setup-guide-need-card">
                    <Database size={16} />
                    <div>
                      <strong>A PostgreSQL URL</strong>
                      <small>From Neon, Supabase, RDS or your own Postgres server.</small>
                    </div>
                  </div>
                  <div className="setup-guide-need-card">
                    <KeyRound size={16} />
                    <div>
                      <strong>A mail provider key</strong>
                      <small>Resend is recommended; your key takes a minute to create.</small>
                    </div>
                  </div>
                </div>
              </div>

              <div className="setup-guide-flow">
                <span className="setup-guide-label">How mail moves</span>
                <div className="setup-guide-flow-row">
                  <span className="setup-guide-flow-icon"><Send size={14} /></span>
                  <span>Sending</span>
                  <strong>Your dashboard → VelisMail → Recipient</strong>
                </div>
                <div className="setup-guide-flow-row">
                  <span className="setup-guide-flow-icon"><Inbox size={14} /></span>
                  <span>Receiving</span>
                  <strong>Sender → your domain MX → VelisMail → Inbox</strong>
                </div>
              </div>

              <p className="setup-guide-note">
                VelisMail never sells domains and never asks you to run a mail server.
                Your domain stays yours; we handle the mail path.
              </p>
            </>
          )}

          {index === 1 && (
            <>
              <div className="setup-guide-card">
                <Server size={16} />
                <div>
                  <strong>Paste one connection URL</strong>
                  <p>
                    The dashboard asks for a PostgreSQL connection string. It stores your
                    mail, contacts, team, domains and settings — nothing leaves your database.
                  </p>
                  <code>postgresql://user:password@host:5432/database</code>
                </div>
              </div>
              <div className="setup-guide-split">
                <div className="setup-guide-mini">
                  <strong>Where to get one</strong>
                  <span>Neon, Supabase, Amazon RDS, Railway or any Postgres host.</span>
                </div>
                <div className="setup-guide-mini">
                  <strong>We test it first</strong>
                  <span>A wrong host or password is caught before it is saved.</span>
                </div>
              </div>
              <p className="setup-guide-tip">
                Tip: use the <strong>pooled</strong> connection string when your provider offers
                one. You can replace the database later from the setup page.
              </p>
            </>
          )}

          {index === 2 && (
            <>
              <div className="setup-guide-card">
                <KeyRound size={16} />
                <div>
                  <strong>Resend is the smoothest path</strong>
                  <p>
                    Paste your Resend API key. VelisMail checks it, then creates the inbound
                    webhook (<code>email.received</code>) for you and stores its signing secret.
                  </p>
                </div>
              </div>
              <div className="setup-guide-split">
                <div className="setup-guide-mini">
                  <strong>Sending</strong>
                  <span>Uses your provider API key and your domain's SPF/DKIM records.</span>
                </div>
                <div className="setup-guide-mini">
                  <strong>Receiving</strong>
                  <span>Uses the webhook plus the MX record you will add in the next step.</span>
                </div>
              </div>
              <div className="setup-guide-chip-row">
                <span className="setup-guide-chip"><Webhook size={13} /> Webhook created automatically</span>
                <span className="setup-guide-chip"><ShieldCheck size={13} /> Secret stored server-side</span>
              </div>
              <p className="setup-guide-note">
                Already using another provider? Choose it in the same form. Resend needs the
                least manual setup for incoming mail.
              </p>
            </>
          )}

          {index === 3 && (
            <>
              <p className="setup-guide-note setup-guide-note-top">
                Add your domain in the dashboard. We show the exact records to copy into your
                DNS provider — no guessing which value goes where.
              </p>
              <div className="setup-guide-records">
                <div className="setup-guide-record">
                  <span className="setup-guide-record-type">MX</span>
                  <div>
                    <strong>Receiving</strong>
                    <small>Points incoming mail at VelisMail.</small>
                  </div>
                </div>
                <div className="setup-guide-record">
                  <span className="setup-guide-record-type">SPF</span>
                  <div>
                    <strong>Sending permission</strong>
                    <small>Allows VelisMail to send for your domain.</small>
                  </div>
                </div>
                <div className="setup-guide-record">
                  <span className="setup-guide-record-type">DKIM</span>
                  <div>
                    <strong>Message signature</strong>
                    <small>Proves each message really came from you.</small>
                  </div>
                </div>
                <div className="setup-guide-record">
                  <span className="setup-guide-record-type">DMARC</span>
                  <div>
                    <strong>Anti-spoofing policy</strong>
                    <small>Tells inboxes what to do with faked mail.</small>
                  </div>
                </div>
              </div>
              <p className="setup-guide-tip">
                DNS changes usually go live in 5–30 minutes. The setup page keeps checking in
                the background, so you can leave it open and come back.
              </p>
            </>
          )}

          {index === 4 && (
            <>
              <div className="setup-guide-card">
                <ShieldCheck size={16} />
                <div>
                  <strong>One click verifies everything</strong>
                  <p>
                    Press Verify in the dashboard. VelisMail checks the live DNS and the
                    receiving webhook; the dashboard unlocks only when every check is green.
                  </p>
                </div>
              </div>
              <ul className="setup-guide-checklist">
                <li><Check size={14} /> Domain verified (SPF, DKIM, DMARC and MX)</li>
                <li><Check size={14} /> Inbound webhook verified automatically</li>
                <li><Check size={14} /> Create mailboxes like <code>you@yourdomain.com</code></li>
                <li><Check size={14} /> Send and receive from the dashboard or API</li>
              </ul>
              <p className="setup-guide-note">
                If something is not ready, the setup page names the exact record or setting to
                fix. Nothing opens until the workspace is genuinely complete.
              </p>
            </>
          )}
        </div>

        <footer className="setup-guide-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={previous}
            disabled={index === 0}
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div className="setup-guide-foot-right">
            <span className="setup-guide-foot-note">
              <Clock3 size={12} /> 10–15 min setup · DNS may take longer
            </span>
            <button type="button" className="btn btn-primary" onClick={next}>
              {isLast ? (
                <>Create my account <ArrowRight size={15} /></>
              ) : (
                <>Next <ArrowRight size={15} /></>
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

const STEP_TITLES = [
  'Create your account',
  'Connect your database',
  'Add your mail provider',
  'Connect your domain’s DNS',
  'Verify once, then start mailing',
] as const;

const STEP_LEADS = [
  'Two minutes, one email and one domain. This is where your workspace begins.',
  'This is where your mail and workspace data live. One URL is all we need.',
  'Your sending credential. Resend also gives you receiving with almost no setup.',
  'Copy four records into your DNS provider. This is what makes mail flow both ways.',
  'The last check. When it passes, your dashboard opens and you can create mailboxes.',
] as const;
