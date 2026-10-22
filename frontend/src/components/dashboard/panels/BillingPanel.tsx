import { CreditCard, Menu, Check } from 'lucide-react';
import LoadingSpinner from '../../LoadingSpinner';
import { PLANS, PLAN_LIMITS } from '../constants';
import type { DashboardState } from '../types';

interface BillingPanelProps {
  state: DashboardState;
  handleBuyPlan: (planId: string) => Promise<void>;
}

function bytes(value?: number | null): string {
  const size = value || 0;
  if (size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function number(value?: number | null): string {
  return new Intl.NumberFormat('en-IN').format(value || 0);
}

export default function BillingPanel({ state, handleBuyPlan }: BillingPanelProps) {
  const currentPlan = (state.user?.plan || 'Free').toLowerCase();
  const currentBilling = state.user?.billingCycle || 'monthly';
  // A plan without a published allowance (Enterprise) is negotiated per
  // customer, so it has no numbers to show here.
  const planAllowance = PLAN_LIMITS[currentPlan];

  const purchasedAt = state.user?.paidPlanPurchasedAt 
    ? new Date(state.user.paidPlanPurchasedAt).toLocaleDateString()
    : state.user?.createdAt 
      ? new Date(state.user.createdAt).toLocaleDateString() 
      : 'N/A';
  
  const expiresAt = state.user?.paidPlanExpiresAt 
    ? new Date(state.user.paidPlanExpiresAt).toLocaleDateString()
    : state.user?.createdAt 
      ? new Date(new Date(state.user.createdAt).getTime() + (currentBilling === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000).toLocaleDateString()
      : 'N/A';

  return (
    <div className="dash-panel billing-panel">
      <div className="panel-header billing-header">
        <div className="mail-panel-title">
          <button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
          <h3><CreditCard size={16} /> Billing & Premium</h3>
        </div>
        <span className="badge badge-neutral">Current: {state.user?.plan || 'Free'}</span>
      </div>

      {currentPlan !== 'free' && (
        <div className="premium-status-card glass-card" style={{ padding: '16px', border: '1px solid var(--border-primary)', background: 'var(--bg-surface-2)', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left', borderRadius: '0' }}>
          <h4 style={{ fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-primary)', margin: 0, letterSpacing: '0.05em' }}>Active Premium Subscription</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '4px' }}>
            <div>
              <span className="text-xs text-muted" style={{ display: 'block', marginBottom: '2px' }}>Activation Date</span>
              <strong className="text-sm text-primary" style={{ fontWeight: '600' }}>{purchasedAt}</strong>
            </div>
            <div>
              <span className="text-xs text-muted" style={{ display: 'block', marginBottom: '2px' }}>Renewal / Expiration Date</span>
              <strong className="text-sm text-primary" style={{ fontWeight: '600' }}>{expiresAt}</strong>
            </div>
            <div>
              <span className="text-xs text-muted" style={{ display: 'block', marginBottom: '2px' }}>Storage limit</span>
              <strong className="text-sm text-primary" style={{ fontWeight: '600' }}>
                {!planAllowance ? 'Custom (negotiated)' : planAllowance.storageBytes > 0 ? bytes(planAllowance.storageBytes) : 'Unlimited'}
              </strong>
            </div>
            <div>
              <span className="text-xs text-muted" style={{ display: 'block', marginBottom: '2px' }}>Mail volume</span>
              <strong className="text-sm text-primary" style={{ fontWeight: '600' }}>
                {!planAllowance
                  ? 'Custom (negotiated)'
                  : planAllowance.emailsPerMonth > 0
                    ? `${number(planAllowance.emailsPerMonth)} emails / month`
                    : 'Unlimited'}
              </strong>
            </div>
          </div>
        </div>
      )}
      <div className="billing-toggle-bar" role="group" aria-label="Billing cycle">
        <span className={!state.annual ? 'active' : ''}>Monthly</span>
        <button
          type="button"
          className={`toggle-switch ${state.annual ? 'active' : ''}`}
          onClick={() => state.setAnnual(!state.annual)}
          aria-label="Toggle annual billing"
          aria-pressed={state.annual}
        >
          <div className="toggle-knob" />
        </button>
        <span className={state.annual ? 'active' : ''}>Annual</span>
        <span className="badge badge-success">Save 16%</span>
      </div>
      <div className="billing-grid">
        {PLANS.map(plan => {
          const isCurrent = currentPlan === plan.name.toLowerCase();
          const selectedBilling = state.annual ? 'annual' : 'monthly';
          const isSelectedCurrentBilling = currentBilling === selectedBilling;
          const price = state.annual ? plan.priceAnnual : plan.priceMonthly;
          return (
          <div key={plan.id} className={`billing-plan-card glass-card ${isCurrent ? 'featured' : ''}`}>
            <h3>{plan.name}</h3>
            <div className="pricing-amount">
              {plan.contactOnly ? (
                <strong>Custom</strong>
              ) : (
                <>
                  <strong>₹{price.toLocaleString('en-IN')}</strong>
                  <span className="text-muted text-sm">/{state.annual ? 'year' : 'month'}</span>
                </>
              )}
            </div>
            <p className="text-sm text-muted">{plan.desc}</p>
            <ul className="pricing-features">
              {plan.features.map(f => <li key={f}><Check size={14} /> {f}</li>)}
            </ul>
            {plan.contactOnly ? (
              isCurrent ? (
                <button className="btn btn-secondary w-full" disabled>Current Plan</button>
              ) : (
                <a
                  className="btn btn-primary w-full"
                  href="mailto:support@velismail.online?subject=Enterprise%20plan%20request"
                >
                  Contact Sales
                </a>
              )
            ) : (
              <button
                className={`btn ${isCurrent ? 'btn-secondary' : 'btn-primary'} w-full`}
                disabled={state.loadingPayment === plan.id || (isCurrent && isSelectedCurrentBilling)}
                onClick={() => handleBuyPlan(plan.id)}
              >
                {state.loadingPayment === plan.id ? <LoadingSpinner size="sm" /> : isCurrent && isSelectedCurrentBilling ? 'Current Plan' : isCurrent ? 'Switch Billing' : 'Upgrade'}
              </button>
            )}
          </div>
        );
        })}
      </div>
    </div>
  );
}
