import { Inbox, Shield, Mail, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type BizTab = 'mail' | 'domains' | 'mailboxes' | 'groups' | 'team' | 'queue' | 'analytics' | 'audit' | 'templates' | 'settings' | 'billing' | 'company-admin' | 'contacts' | 'deliverability';

export type BizFolder = { id: string; label: string; icon: LucideIcon; badge?: string };

export const BIZ_FOLDERS: BizFolder[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Shield },
  { id: 'sent', label: 'Sent', icon: Mail },
  { id: 'drafts', label: 'Drafts', icon: Layers },
  { id: 'archive', label: 'Archive', icon: Inbox },
  { id: 'trash', label: 'Trash', icon: Inbox },
  { id: 'priority', label: 'Priority', icon: Shield, badge: 'express' },
  { id: 'scheduled', label: 'Scheduled', icon: Mail, badge: 'time' },
  { id: 'spam', label: 'Spam', icon: Shield },
];

/**
 * The allowance of every plan.
 *
 * The numbers mirror the shared backend table (crates/common/src/plans.rs),
 * which is what the tenant service actually enforces. A limit of zero means
 * the plan does not cap it.
 *
 * Enterprise is deliberately absent: it is only available on request, so it
 * has no published allowance at all. What it gets is negotiated per customer
 * and stored on the tenant.
 */
export const PLAN_LIMITS: Record<string, { seats: number; emailsPerMonth: number; storageBytes: number; apiRequestsPerMinute: number; maxDomains: number }> = {
  free: { seats: 3, emailsPerMonth: 3_000, storageBytes: 500 * 1024 * 1024, apiRequestsPerMinute: 30, maxDomains: 1 },
  starter: { seats: 15, emailsPerMonth: 150_000, storageBytes: 10 * 1024 * 1024 * 1024, apiRequestsPerMinute: 120, maxDomains: 3 },
  business: { seats: 75, emailsPerMonth: 750_000, storageBytes: 50 * 1024 * 1024 * 1024, apiRequestsPerMinute: 500, maxDomains: 10 },
};

export const PLANS = [
  { id: 'free', name: 'Free', priceMonthly: 0, priceAnnual: 0, contactOnly: false, desc: '1 domain, 5 mailboxes', features: ['1 Custom Domain', '5 Mailboxes', 'Basic Queue', 'Community Support'] },
  { id: 'starter', name: 'Starter', priceMonthly: 299, priceAnnual: Math.round(299 * 12 * 0.84), contactOnly: false, desc: '3 domains, 25 mailboxes', features: ['3 Custom Domains', '25 Mailboxes', 'Queue Monitoring', 'Email Support', 'Basic Templates'] },
  { id: 'business', name: 'Business', priceMonthly: 999, priceAnnual: Math.round(999 * 12 * 0.84), contactOnly: false, desc: '10 domains, unlimited mailboxes', features: ['10 Custom Domains', 'Unlimited Mailboxes', 'Priority Queue', 'Advanced Templates', 'Team Access', 'Audit Logs', 'Priority Support'] },
  { id: 'enterprise', name: 'Enterprise', priceMonthly: 2499, priceAnnual: Math.round(2499 * 12 * 0.84), contactOnly: true, desc: 'Unlimited domains & users', features: ['Unlimited Domains', 'Unlimited Mailboxes', 'Dedicated Queue', 'Custom Templates', 'Bulk Operations', 'SLA Guarantee', 'Phone Support', 'White Label'] },
];

export const ROLE_ALLOWED_TABS: Record<string, BizTab[]> = {
  admin: ['mail', 'templates', 'queue', 'domains', 'mailboxes', 'groups', 'team', 'analytics', 'audit', 'settings', 'billing', 'company-admin', 'contacts', 'deliverability'],
  member: ['mail', 'templates', 'queue', 'analytics', 'domains', 'mailboxes', 'groups', 'team', 'audit', 'settings', 'billing', 'contacts', 'deliverability'],
  viewer: ['mail', 'analytics', 'domains', 'mailboxes', 'groups', 'team', 'audit', 'settings', 'billing', 'contacts', 'deliverability'],
  user: ['mail', 'contacts', 'settings'],
};
