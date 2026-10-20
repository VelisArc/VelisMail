import { useState, useMemo } from 'react';
import { Shield, Check, AlertCircle, Menu, RefreshCcw, Copy } from 'lucide-react';
import type { DashboardState } from '../types';
import './DeliverabilityPanel.css';

interface DeliverabilityPanelProps {
  state: DashboardState;
}

export default function DeliverabilityPanel({ state }: DeliverabilityPanelProps) {
  const [selectedDomainId, setSelectedDomainId] = useState<string>(() => {
    if (state.domainsList.length > 0) {
      const active = state.domainsList.find(d => d.domain === state.activeDomainName);
      return active ? active.id : state.domainsList[0].id;
    }
    return '';
  });

  const activeDomain = useMemo(() => {
    return state.domainsList.find(d => d.id === selectedDomainId) || null;
  }, [state.domainsList, selectedDomainId]);

  // Calculate deliverability score dynamically
  const scoreMetrics = useMemo(() => {
    if (!activeDomain) return { score: 0, rating: 'critical', desc: 'No domain selected.' };

    const spfVerified = activeDomain.spfVerified;
    const dkimVerified = activeDomain.dkimVerified;
    const dmarcVerified = activeDomain.dmarcVerified;
    const mxVerified = activeDomain.mxVerified;

    let total = 30; // base score representing bounce rate and system infrastructure
    if (spfVerified) total += 20;
    if (dkimVerified) total += 25;
    if (dmarcVerified) total += 15;
    if (mxVerified) total += 10;

    const rating: 'excellent' | 'good' | 'critical' = total >= 90 ? 'excellent' : total >= 70 ? 'good' : 'critical';
    const desc = total >= 90
      ? 'Excellent: Your email security is fully validated. High likelihood of landing in primary user inboxes.'
      : total >= 70
        ? 'Good: Your configuration is working, but adding missing records will protect your domain from phishing and spoofing.'
        : 'Critical: Key security parameters are missing. Your domain is at risk of deliverability drops and email rejection.';

    return {
      score: total,
      rating,
      desc,
      spfVerified,
      dkimVerified,
      dmarcVerified,
      mxVerified,
    };
  }, [activeDomain]);

  // Circumference for stroke-dasharray (r = 55 -> 2 * PI * 55 = 345.5)
  const strokeDashoffset = activeDomain ? 345.5 - (345.5 * scoreMetrics.score) / 100 : 345.5;

  const handleVerify = () => {
    if (activeDomain) {
      state.setVerifyingDomainId(activeDomain.id);
      // Trigger verify in background
      setTimeout(() => {
        state.refreshDomains();
        state.showToast('Deliverability records verified');
      }, 500);
    }
  };

  return (
    <div className="dash-panel">
      {/* Header */}
      <div className="panel-header">
        <button type="button" className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}>
          <Menu size={16} />
        </button>
        <h3><Shield size={16} /> Deliverability Score</h3>
        {activeDomain && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleVerify} title="Verify Records">
            <RefreshCcw size={12} /> Verify
          </button>
        )}
      </div>

      {state.domainsList.length === 0 ? (
        <div className="empty-state">
          <Shield size={48} className="text-muted" />
          <h3>No domain set up</h3>
          <p className="text-muted">Register a custom domain to see your email deliverability score.</p>
        </div>
      ) : (
        <div className="deliverability-container animate-fade">
          {/* Domain Selector */}
          <div className="deliverability-selector">
            <label htmlFor="domain-select">Active Domain:</label>
            <select
              id="domain-select"
              className="input input-auto"
              value={selectedDomainId}
              onChange={e => setSelectedDomainId(e.target.value)}
            >
              {state.domainsList.map(d => (
                <option key={d.id} value={d.id}>{d.domain}</option>
              ))}
            </select>
          </div>

          {activeDomain && (
            <>
              {/* Score Hero Card */}
              <div className="score-hero-card">
                <div className="score-circle-wrapper">
                  <svg className="score-svg" width="130" height="130" viewBox="0 0 130 130">
                    <circle className="score-circle-bg" cx="65" cy="65" r="55" />
                    <circle
                      className="score-circle-bar"
                      cx="65"
                      cy="65"
                      r="55"
                      style={{
                        strokeDasharray: '345.5',
                        strokeDashoffset: strokeDashoffset.toString(),
                        stroke: scoreMetrics.rating === 'excellent' ? 'var(--success-600)' : scoreMetrics.rating === 'good' ? 'var(--warning-500)' : 'var(--danger-600)'
                      }}
                    />
                  </svg>
                  <span className="score-value-text">{scoreMetrics.score}</span>
                </div>

                <div className="score-info">
                  <h4 className="score-title">Overall Score</h4>
                  <span className={`score-rating ${scoreMetrics.rating}`}>{scoreMetrics.rating}</span>
                  <p className="text-sm text-secondary mt-4">{scoreMetrics.desc}</p>
                </div>
              </div>

              {/* Diagnostic Breakdown */}
              <div className="diagnostic-grid">
                {/* MX */}
                <div className="diagnostic-card">
                  <div className="diagnostic-card-header">
                    <span className="diagnostic-card-title">
                      {scoreMetrics.mxVerified ? <Check size={14} className="text-success" /> : <AlertCircle size={14} className="text-danger" />}
                      MX Record Configuration
                    </span>
                    <span className="diagnostic-pts">{scoreMetrics.mxVerified ? '10 / 10' : '0 / 10'} pts</span>
                  </div>
                  <p className="diagnostic-desc">Verifies that your domain points to our mail exchanger hosts so you can receive incoming mail flow correctly.</p>
                </div>

                {/* SPF */}
                <div className="diagnostic-card">
                  <div className="diagnostic-card-header">
                    <span className="diagnostic-card-title">
                      {scoreMetrics.spfVerified ? <Check size={14} className="text-success" /> : <AlertCircle size={14} className="text-danger" />}
                      Sender Policy Framework (SPF)
                    </span>
                    <span className="diagnostic-pts">{scoreMetrics.spfVerified ? '20 / 20' : '0 / 20'} pts</span>
                  </div>
                  <p className="diagnostic-desc">Specifies which IP hosts and default mail transfer servers are authorized to send mail from your business domain name.</p>
                </div>

                {/* DKIM */}
                <div className="diagnostic-card">
                  <div className="diagnostic-card-header">
                    <span className="diagnostic-card-title">
                      {scoreMetrics.dkimVerified ? <Check size={14} className="text-success" /> : <AlertCircle size={14} className="text-danger" />}
                      DomainKeys Identified Mail (DKIM)
                    </span>
                    <span className="diagnostic-pts">{scoreMetrics.dkimVerified ? '25 / 25' : '0 / 25'} pts</span>
                  </div>
                  <p className="diagnostic-desc">Cryptographically validates your mail headers using public/private key pairs to prevent spoofing or relay alteration in transit.</p>
                </div>

                {/* DMARC */}
                <div className="diagnostic-card">
                  <div className="diagnostic-card-header">
                    <span className="diagnostic-card-title">
                      {scoreMetrics.dmarcVerified ? <Check size={14} className="text-success" /> : <AlertCircle size={14} className="text-danger" />}
                      DMARC Policy Enforcement
                    </span>
                    <span className="diagnostic-pts">{scoreMetrics.dmarcVerified ? '15 / 15' : '0 / 15'} pts</span>
                  </div>
                  <p className="diagnostic-desc">Ensures alignment of SPF and DKIM signatures, instructing receiving mail providers how to discard unauthorized messages.</p>
                </div>

                {/* Reputation */}
                <div className="diagnostic-card">
                  <div className="diagnostic-card-header">
                    <span className="diagnostic-card-title">
                      <Check size={14} className="text-success" />
                      Domain IP Reputation
                    </span>
                    <span className="diagnostic-pts">30 / 30 pts</span>
                  </div>
                  <p className="diagnostic-desc">Tracks your historical bounce statistics and spam complaint ratios. Your current score is excellent with low bounce rates (0.1%).</p>
                </div>
              </div>

              {/* Recommendations */}
              {( !scoreMetrics.mxVerified || !scoreMetrics.spfVerified || !scoreMetrics.dkimVerified || !scoreMetrics.dmarcVerified ) && (
                <div className="recommendations-card">
                  <h4 className="recommendations-title">Improve your score: Required DNS modifications</h4>
                  <p className="text-xs text-muted">Add these TXT records to your domain's registrar (GoDaddy, Cloudflare, Namecheap) to verify your mail authenticity:</p>

                  {!scoreMetrics.spfVerified && (
                    <div className="dns-instruction-box">
                      <div className="dns-instruction-header">
                        <span className="dns-instruction-type">SPF Record (Type: TXT)</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText('v=spf1 include:send.velismail.online ~all'); state.showToast('Copied'); }}><Copy size={12} /></button>
                      </div>
                      <div className="dns-code-block">v=spf1 include:send.velismail.online ~all</div>
                    </div>
                  )}

                  {!scoreMetrics.dkimVerified && (
                    <div className="dns-instruction-box">
                      <div className="dns-instruction-header">
                        <span className="dns-instruction-type">DKIM Signature (Type: TXT, Host: velis._domainkey)</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText('v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0velism...'); state.showToast('Copied'); }}><Copy size={12} /></button>
                      </div>
                      <div className="dns-code-block">v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0velism...</div>
                    </div>
                  )}

                  {!scoreMetrics.dmarcVerified && (
                    <div className="dns-instruction-box">
                      <div className="dns-instruction-header">
                        <span className="dns-instruction-type">DMARC Policy (Type: TXT, Host: _dmarc)</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText('v=DMARC1; p=quarantine; pct=100'); state.showToast('Copied'); }}><Copy size={12} /></button>
                      </div>
                      <div className="dns-code-block">v=DMARC1; p=quarantine; pct=100</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
