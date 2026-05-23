import { CreditCard, Menu, Check } from 'lucide-react';
import LoadingSpinner from '../../LoadingSpinner';
import type { DashboardState } from '../types';

const PLANS = [
  { id: 'free', name: 'Free', priceMonthly: 0, priceAnnual: 0, desc: '1 domain, 5 mailboxes', features: ['1 Custom Domain', '5 Mailboxes', 'Basic Queue', 'Community Support'] },
  { id: 'starter', name: 'Starter', priceMonthly: 299, priceAnnual: 2999, desc: '3 domains, 25 mailboxes', features: ['3 Custom Domains', '25 Mailboxes', 'Queue Monitoring', 'Email Support', 'Basic Templates'] },
  { id: 'business', name: 'Business', priceMonthly: 999, priceAnnual: 9999, desc: '10 domains, unlimited mailboxes', features: ['10 Custom Domains', 'Unlimited Mailboxes', 'Priority Queue', 'Advanced Templates', 'Team Access', 'Audit Logs', 'Priority Support'] },
  { id: 'enterprise', name: 'Enterprise', priceMonthly: 2499, priceAnnual: 24999, desc: 'Unlimited domains & users', features: ['Unlimited Domains', 'Unlimited Mailboxes', 'Dedicated Queue', 'Custom Templates', 'Bulk Operations', 'SLA Guarantee', 'Phone Support', 'White Label'] },
];

interface BillingPanelProps {
  state: DashboardState;
  handleBuyPlan: (planId: string) => Promise<void>;
}

export default function BillingPanel({ state, handleBuyPlan }: BillingPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><CreditCard size={16} /> Billing & Premium</h3></div>
      <div className="flex items-center gap-3 billing-toggle-bar">
        <span className="text-sm">Monthly</span>
        <button type="button" className={`toggle-switch ${state.annual ? 'active' : ''}`} onClick={() => state.setAnnual(!state.annual)}>
          <div className="toggle-knob" />
        </button>
        <span className="text-sm">Annual <span className="badge badge-success badge-ml">Save 16%</span></span>
      </div>
      <div className="billing-grid">
        {PLANS.map(plan => (
          <div key={plan.id} className={`pricing-card glass-card ${plan.priceMonthly === 0 ? 'featured' : ''}`}>
            <h3>{plan.name}</h3>
            <div className="pricing-amount">
              <strong>₹{state.annual ? plan.priceAnnual : plan.priceMonthly}</strong>
              <span className="text-muted text-sm">/{state.annual ? 'year' : 'month'}</span>
            </div>
            <p className="text-sm text-muted">{plan.desc}</p>
            <ul className="pricing-features">
              {plan.features.map(f => <li key={f}><Check size={14} /> {f}</li>)}
            </ul>
            <button className={`btn ${plan.priceMonthly === 0 ? 'btn-secondary' : 'btn-primary'} w-full`} disabled={state.loadingPayment === plan.id} onClick={() => handleBuyPlan(plan.id)}>
              {state.loadingPayment === plan.id ? <LoadingSpinner size="sm" /> : plan.priceMonthly === 0 ? 'Current Plan' : 'Upgrade'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
