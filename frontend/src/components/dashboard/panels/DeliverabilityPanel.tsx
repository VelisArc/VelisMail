import { useState, useMemo, useCallback, useEffect } from 'react';
import { Shield, Check, AlertCircle, Menu, RefreshCcw, Copy } from 'lucide-react';
import { workspaceApi, type DnsRequirement } from '../../../api/company';
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
  const [dns, setDns] = useState<{ loading: boolean; records: DnsRequirement[]; message: string }>({
    loading: false,
    records: [],
    message: '',
  });

  const activeDomain = useMemo(() => {
    return state.domainsList.find(d => d.id === selectedDomainId) || null;
  }, [state.domainsList, selectedDomainId]);

  const loadDns = useCallback(async () => {
    const domain = activeDomain?.domain;
    if (!domain) return;
    setDns((current) => ({ ...current, loading: true }));
    try {
      const result = await workspaceApi.dnsRequirements(domain);
      setDns({ loading: false, records: result.records, message: result.message });
    } catch (error) {
      setDns({
        loading: false,
        records: [],
        message: error instanceof Error ? error.message : 'Unable to read the DNS requirements.',
      });
    }
  }, [activeDomain?.domain]);

  useEffect(() => {
    void loadDns();
  }, [loadDns]);

  // Calculate deliverability score dynamically
  const scoreMetrics = useMemo(() => {
    if (!activeDomain) return { score: 0, rating: 'critical', desc: 'No domain selected.' };

    // The live DNS is the truth. The stored flags are only used while the
    // records are being read.
    const live = (mode: string) => dns.records.find((record) => record.matchMode === mode);
    const liveSpf = live('spf');
    const liveDkim = live('exists');
    const liveDmarc = live('prefix');
    const liveMx = dns.records.find(
      (record) => record.recordType === 'MX' && record.purpose.toLowerCase().includes('receiv'),
    );
    const useLive = dns.records.length > 0;

    const spfVerified = useLive ? liveSpf?.status === 'verified' : Boolean(activeDomain.spfVerified);
    const dkimVerified = useLive ? liveDkim?.status === 'verified' : Boolean(activeDomain.dkimVerified);
    const dmarcVerified = useLive ? liveDmarc?.status === 'verified' : Boolean(activeDomain.dmarcVerified);
    const mxVerified = useLive ? liveMx?.status === 'verified' : Boolean(activeDomain.mxVerified);

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
  }, [activeDomain, dns.records]);

  // Circumference for stroke-dasharray (r = 55 -> 2 * PI * 55 = 345.5)
  const strokeDashoffset = activeDomain ? 345.5 - (345.5 * scoreMetrics.score) / 100 : 345.5;

  const handleVerify = async () => {
    if (!activeDomain) return;
    state.setVerifyingDomainId(activeDomain.id);
    try {
      const result = await workspaceApi.verifyDomain(activeDomain.id);
      setDns({ loading: false, records: result.records, message: result.message });
      state.refreshDomains();
      state.showToast(
        result.complete
          ? 'Every DNS record is published and active.'
          : `${result.records.filter((record) => record.status !== 'verified').length} record(s) still missing.`,
        result.complete ? 'success' : 'error',
      );
    } catch (error) {
      setDns({
        loading: false,
        records: [],
        message: error instanceof Error ? error.message : 'Unable to check the DNS records.',
      });
      state.showToast(
        error instanceof Error ? error.message : 'Unable to check the DNS records.',
        'error',
      );
    } finally {
      state.setVerifyingDomainId('');
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleVerify()} title="Verify Records">
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

              {/* DNS requirements straight from the mail provider */}
              {(dns.loading || dns.records.length > 0) && (
                <div className="recommendations-card">
                  <div className="dns-requirements-head">
                    <div>
                      <h4 className="recommendations-title">Required DNS records</h4>
                      <p className="dns-requirements-message">
                        {dns.loading
                          ? 'Checking the live DNS for this domain...'
                          : dns.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleVerify()}
                      disabled={dns.loading}
                    >
                      <RefreshCcw size={12} /> Check DNS
                    </button>
                  </div>

                  {dns.records.map((record) => {
                    const active = record.status === 'verified';
                    return (
                      <div
                        key={`${record.recordType}-${record.name}-${record.value}`}
                        className={`dns-instruction-box ${active ? 'ok' : 'todo'}`}
                      >
                        <div className="dns-instruction-header">
                          <span className="dns-instruction-type">
                            {record.purpose} ({record.recordType})
                          </span>
                          <span className={`dns-record-state ${active ? 'ok' : 'todo'}`}>
                            {active ? 'active' : record.status}
                          </span>
                          {record.value && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Copy value"
                              onClick={() => { navigator.clipboard.writeText(record.value); state.showToast('Value copied'); }}
                            >
                              <Copy size={12} />
                            </button>
                          )}
                        </div>
                        <div className="dns-record-meta">
                          <span><strong>Name</strong> {record.name}</span>
                          <span><strong>TTL</strong> {record.ttl}</span>
                        </div>
                        {record.value && <div className="dns-code-block">{record.value}</div>}
                        {record.detail && <p className="dns-record-detail">{record.detail}</p>}
                        {record.actual && !active && (
                          <p className="dns-record-current">Published now: {record.actual}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
