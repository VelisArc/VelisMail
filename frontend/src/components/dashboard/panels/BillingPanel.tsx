import { CreditCard, Menu, Check } from 'lucide-react';
import LoadingSpinner from '../../LoadingSpinner';
import { PLANS } from '../constants';
import type { DashboardState } from '../types';

interface BillingPanelProps {
  state: DashboardState;
  handleBuyPlan: (planId: string) => Promise<void>;
}

export default function BillingPanel({ state, handleBuyPlan }: BillingPanelProps) {
  const currentPlan = (state.user?.plan || 'Free').toLowerCase();
  const currentBilling = state.user?.billingCycle || 'monthly';

  return (
    <div className="dash-panel billing-panel">
      <div className="panel-header billing-header">
        <div className="mail-panel-title">
          <button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
          <h3><CreditCard size={16} /> Billing & Premium</h3>
        </div>
        <span className="badge badge-neutral">Current: {state.user?.plan || 'Free'}</span>
      </div>
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
              <strong>₹{price.toLocaleString('en-IN')}</strong>
              <span className="text-muted text-sm">/{state.annual ? 'year' : 'month'}</span>
            </div>
            <p className="text-sm text-muted">{plan.desc}</p>
            <ul className="pricing-features">
              {plan.features.map(f => <li key={f}><Check size={14} /> {f}</li>)}
            </ul>
            <button
              className={`btn ${isCurrent ? 'btn-secondary' : 'btn-primary'} w-full`}
              disabled={state.loadingPayment === plan.id || (isCurrent && isSelectedCurrentBilling)}
              onClick={() => handleBuyPlan(plan.id)}
            >
              {state.loadingPayment === plan.id ? <LoadingSpinner size="sm" /> : isCurrent && isSelectedCurrentBilling ? 'Current Plan' : isCurrent ? 'Switch Billing' : 'Upgrade'}
            </button>
          </div>
        );
        })}
      </div>
    </div>
  );
}
