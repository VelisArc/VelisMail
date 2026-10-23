import { Link } from 'react-router-dom';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ArrowRight, CheckCircle2, Database, Fingerprint,
  Globe, Lock, Mail, Shield,
  Zap, Users, ChevronDown,
  ArrowUp, BarChart3, Activity,
} from 'lucide-react';
import { auth, fetchApiResponse, isBusinessSetupReady } from '../api/client';

import SEO from '../components/SEO';
import SiteNav from '../components/site/SiteNav';
import SiteFooter from '../components/site/SiteFooter';
import './Home.css';

// Feature data with semantic structure for better SEO
const features = [
  { icon: Lock, title: 'Encrypted Transport', desc: 'Every connection uses TLS. Mail is stored in an encrypted database with per-workspace access rules.', category: 'security' },
  { icon: Fingerprint, title: 'Controlled Sign-In', desc: 'Password, Google sign-in and email codes, with sessions you can revoke from the dashboard at any time.', category: 'security' },
  { icon: Globe, title: 'Smart DNS Management', desc: 'Automated SPF, DKIM, and DMARC verification. Guided domain setup with live DNS diagnostics.', category: 'infrastructure' },
  { icon: BarChart3, title: 'Delivery Analytics', desc: 'Track queue health, delivery rates, and audit trails with real-time operational dashboards.', category: 'analytics' },
  { icon: Users, title: 'Team Collaboration', desc: 'Role-based access for admins, members, and viewers. Shared inboxes and distribution groups.', category: 'collaboration' },
  { icon: Database, title: 'Bring Your Own Stack', desc: 'Connect your own database and mail provider. Full control over your infrastructure.', category: 'infrastructure' },
] as const;

const steps = [
  { num: '01', title: 'Connect Your Domain', desc: 'Add your business domain and verify ownership with automatic DNS record generation.', icon: Globe },
  { num: '02', title: 'Provision Your Team', desc: 'Create mailboxes, set up groups, and invite team members with granular permission controls.', icon: Users },
  { num: '03', title: 'Go Live', desc: 'Send authenticated email with real-time monitoring, audit logs, and delivery insights.', icon: Shield },
] as const;

const stats = [
  { value: '4 records', label: 'DNS verification', icon: Lock, description: 'SPF, DKIM, DMARC and MX checked live' },
  { value: 'Scoped keys', label: 'API access', icon: Activity, description: 'Every workspace key carries explicit scopes' },
  { value: 'Live queue', label: 'Delivery tracking', icon: Zap, description: 'Queued, sending, sent and failed states' },
  { value: 'Audit log', label: 'Accountability', icon: Shield, description: 'Every workspace change is recorded' },
] as const;

const solutions = [
  { title: 'Enterprise Security', desc: 'Role-based access, audit trails, and scoped API keys for security-conscious organizations.', industries: ['Finance', 'Healthcare', 'Legal'] },
  { title: 'Regulated Industries', desc: 'Data residency in your own database, retained audit history, and records of every admin change.', industries: ['Healthcare', 'Finance', 'Legal'] },
  { title: 'Remote Teams', desc: 'One console for domains, mailboxes, groups and the delivery queue across a distributed workforce.', industries: ['Technology', 'Consulting', 'Media'] },
  { title: 'Scaling Startups', desc: 'From 10 to 10,000 users with instant provisioning and predictable per-user pricing.', industries: ['SaaS', 'E-commerce', 'Fintech'] },
] as const;

const faqs = [
  { q: 'How is my mail protected?', a: 'Mail moves over TLS and is stored in an encrypted database. Access is limited to your workspace. VelisMail is not an end-to-end encrypted service: the mail service can read a message in order to deliver and index it.', schema: 'encryption' },
  { q: 'Can I migrate from Gmail or Outlook?', a: 'Not automatically yet. Automated IMAP import from Google Workspace and Microsoft 365 is on the roadmap. You can connect your domain and create mailboxes today; historical mail import is not offered.', schema: 'migration' },
  { q: 'What happens if a device is lost?', a: 'Sessions can be revoked from the dashboard instantly. The user signs in again with their password, Google sign-in or an email code.', schema: 'security' },
  { q: 'Is custom branding available?', a: 'White-labeling and a dedicated queue are negotiated with our sales team on the Enterprise plan. The self-serve plans keep the VelisMail console.', schema: 'branding' },
] as const;

type SubmissionState = { type: 'success' | 'info' | 'error'; message: string } | null;

interface FeedbackFormState {
  name: string;
  email: string;
  type: 'suggestion' | 'bug' | 'feature' | 'praise';
  message: string;
}

// Custom hooks with proper TypeScript types and cleanup
function useScrollToTop(): { visible: boolean; scrollToTop: () => void } {
  const [visible, setVisible] = useState<boolean>(false);
  
  useEffect(() => {
    const check = (): void => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);
  
  const scrollToTop = useCallback((): void => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  
  return { visible, scrollToTop };
}

function useIntersectionObserver(): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );
    
    const elements = node.querySelectorAll('.animate-on-scroll');
    elements.forEach((el) => observer.observe(el));
    
    return () => observer.disconnect();
  }, []);
  
  return ref;
}

export default function Home(): React.ReactElement {
  const [user] = useState(auth.getSession());
  const { visible: showScrollTop, scrollToTop } = useScrollToTop();
  const animationRef = useIntersectionObserver();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [feedbackForm, setFeedbackForm] = useState<FeedbackFormState>({ name: '', email: '', type: 'suggestion', message: '' });
  const [feedbackSending, setFeedbackSending] = useState<boolean>(false);
  const [feedbackState, setFeedbackState] = useState<SubmissionState>(null);

  const getDashboardLink = useCallback((): string => {
    if (!user) return '/login?mode=register';
    return '/business';
  }, [user]);

  const getDashboardText = useCallback((): string => {
    if (!user) return 'Get Started Free';
    return isBusinessSetupReady(user) ? 'Open Dashboard' : 'Continue Setup';
  }, [user]);

  const handleFeedbackSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setFeedbackSending(true);
    setFeedbackState(null);
    
    try {
      await fetchApiResponse('/auth/feedback', {
        method: 'POST',
        body: JSON.stringify(feedbackForm),
      });
      setFeedbackState({ type: 'success', message: 'Feedback submitted successfully. Thank you for your support!' });
      setFeedbackForm({ name: '', email: '', type: 'suggestion', message: '' });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '';
      if (errorMsg && !errorMsg.includes('Failed to fetch') && !errorMsg.includes('NetworkError')) {
        setFeedbackState({ type: 'error', message: `Submission failed: ${errorMsg}` });
      } else {
        // Nothing is stored on the device: a message that was never sent must
        // not look like a message that will be sent later.
        setFeedbackState({ type: 'error', message: 'The feedback service could not be reached. Nothing was sent. Please try again or email support@velismail.online.' });
      }
    } finally {
      setFeedbackSending(false);
    }
  }, [feedbackForm]);

  const toggleFaq = useCallback((index: number): void => {
    setOpenFaq(openFaq === index ? null : index);
  }, [openFaq]);

  return (
    <div className="home animate-page">
      <SEO 
        title="Business Email Platform"
        description="Business email for custom domains. Mail queues, scheduled send, team collaboration, live DNS verification, scoped API keys and delivery analytics."
        keywords={['business email platform', 'custom domain email', 'email hosting', 'email with queues', 'scheduled email send', 'dns verification']}
      />

      <SiteNav />

      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="hero-badge">
              <Shield size={14} aria-hidden="true" />
              <span>Mail operations for serious teams</span>
            </div>

            <h1 className="hero-title">
              Run business email
              <span>with control.</span>
            </h1>

            <p className="hero-subtitle">
              Operate domains, mailboxes, teams, delivery queues, templates, billing,
              and audit trails from one focused console built for daily administration.
            </p>

            <div className="hero-actions">
              <Link to={getDashboardLink()} className="btn btn-primary btn-lg">
                {getDashboardText()} <ArrowRight size={20} aria-hidden="true" />
              </Link>
              <a href="#features" className="btn btn-secondary btn-lg">Review Platform</a>
            </div>

            <div className="hero-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="hero-stat">
                  <div className="stat-icon" aria-hidden="true">
                    <stat.icon size={14} />
                  </div>
                  <div>
                    <span className="stat-value">{stat.value}</span>
                    <span className="stat-label">{stat.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-visual-inner">
              <div className="hero-float-card hero-float-1">
                <div className="hero-float-icon"><Mail size={16} aria-hidden="true" /></div>
                <div className="hero-float-lines"><span></span><span></span></div>
              </div>
              <div className="hero-float-card hero-float-2">
                <div className="hero-float-icon"><Lock size={16} aria-hidden="true" /></div>
                <div className="hero-float-lines"><span></span><span></span></div>
              </div>
              <div className="hero-float-card hero-float-3">
                <div className="hero-float-icon"><Zap size={16} aria-hidden="true" /></div>
                <div className="hero-float-lines"><span></span><span></span></div>
              </div>
              <div className="hero-orbit-ring"></div>
              <div className="hero-orbit-ring hero-orbit-ring-2"></div>
              <div className="hero-center-badge">
                <Shield size={28} />
                <span>Encrypted</span>
              </div>
              <div className="hero-dots">
                <span></span><span></span><span></span>
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div ref={animationRef}>
        <section id="features" className="section animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">Platform</span>
              <h2 className="section-title">Everything you need, nothing you don't.</h2>
              <p className="section-desc">
                Core capabilities designed for real teams handling real email at scale.
              </p>
            </div>

            <div className="features-grid stagger-children">
              {features.map((f) => (
                <div key={f.title} className="feature-card">
                  <div className="feature-icon-wrap" aria-hidden="true">
                    <f.icon size={22} />
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">How It Works</span>
              <h2 className="section-title">Three steps to secure email.</h2>
              <p className="section-desc">
                Get your team up and running in minutes, not days.
              </p>
            </div>

            <div className="steps-grid">
              {steps.map((step) => (
                <div key={step.num} className="step-card">
                  <div className="step-number" aria-hidden="true">{step.num}</div>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="solutions" className="section animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">Use Cases</span>
              <h2 className="section-title">Built for the way you work.</h2>
              <p className="section-desc">
                From startups to regulated enterprises, VelisMail adapts to your needs.
              </p>
            </div>
            <div className="solutions-grid">
              {solutions.map((s) => (
                <div key={s.title} className="solution-card">
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="section section-alt animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">Support</span>
              <h2 className="section-title">Common questions.</h2>
              <p className="section-desc">
                Everything you need to know about VelisMail.
              </p>
            </div>

            <div className="faq-list">
              {faqs.map((faq, idx) => (
                <div key={idx} className="faq-item">
                  <button
                    type="button"
                    className="faq-trigger"
                    onClick={() => toggleFaq(idx)}
                    aria-expanded={openFaq === idx}
                    aria-controls={`faq-answer-${idx}`}
                  >
                    <span>{faq.q}</span>
                    <ChevronDown size={20} className="faq-icon" aria-hidden="true" />
                  </button>
                  <div
                    id={`faq-answer-${idx}`}
                    className={`faq-content ${openFaq === idx ? 'open' : ''}`}
                    role="region"
                    aria-hidden={openFaq !== idx}
                  >
                    <p className="faq-answer">{faq.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="feedback" className="section animate-on-scroll">
          <div className="container feedback-container">
            <div className="feedback-copy">
              <span className="section-badge">Community</span>
              <h2>Help shape VelisMail.</h2>
              <p>
                Your feedback goes directly to our engineering team. Every suggestion
                and report helps us build a better platform.
              </p>
              <div className="feedback-benefits">
                <div className="feedback-benefit">
                  <CheckCircle2 size={18} className="benefit-icon" aria-hidden="true" />
                  <span>Direct line to developers</span>
                </div>
                <div className="feedback-benefit">
                  <CheckCircle2 size={18} className="benefit-icon" aria-hidden="true" />
                  <span>Weekly iteration cycles</span>
                </div>
              </div>
            </div>

            <div className="feedback-form-card">
              <h3>Send us a note</h3>
              {feedbackState && (
                <div className={`inline-alert ${feedbackState.type}`} role="alert">
                  {feedbackState.message}
                </div>
              )}
              <form className="inline-form" onSubmit={handleFeedbackSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label" htmlFor="feedback-name">Name</label>
                    <input
                      id="feedback-name"
                      className="input"
                      placeholder="Jane Doe"
                      value={feedbackForm.name}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="feedback-email">Email</label>
                    <input
                      id="feedback-email"
                      className="input"
                      type="email"
                      placeholder="jane@company.com"
                      value={feedbackForm.email}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, email: e.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="feedback-type">Type</label>
                  <select
                    id="feedback-type"
                    className="input"
                    value={feedbackForm.type}
                    onChange={(e) => setFeedbackForm((prev) => ({ ...prev, type: e.target.value as FeedbackFormState['type'] }))}
                  >
                    <option value="suggestion">Suggestion</option>
                    <option value="bug">Bug Report</option>
                    <option value="feature">Feature Request</option>
                    <option value="praise">General Praise</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="feedback-message">Message</label>
                  <textarea
                    id="feedback-message"
                    className="input"
                    rows={4}
                    placeholder="What can we do better?"
                    value={feedbackForm.message}
                    onChange={(e) => setFeedbackForm((prev) => ({ ...prev, message: e.target.value }))}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary feedback-submit" disabled={feedbackSending}>
                  {feedbackSending ? 'Sending...' : 'Submit Feedback'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>

      <SiteFooter />

      <button
        type="button"
        className={`scroll-to-top ${showScrollTop ? 'visible' : ''}`}
        onClick={scrollToTop}
        aria-label="Scroll to top"
      >
        <ArrowUp size={20} />
      </button>
    </div>
  );
}
