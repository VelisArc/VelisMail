import { Inbox, Shield, Mail, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type BizTab = 'mail' | 'domains' | 'mailboxes' | 'groups' | 'team' | 'queue' | 'analytics' | 'audit' | 'templates' | 'settings' | 'billing' | 'admin' | 'contacts' | 'deliverability';

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

export const PLANS = [
  { id: 'free', name: 'Free', priceMonthly: 0, priceAnnual: 0, desc: '1 domain, 5 mailboxes', features: ['1 Custom Domain', '5 Mailboxes', 'Basic Queue', 'Community Support'] },
  { id: 'starter', name: 'Starter', priceMonthly: 299, priceAnnual: Math.round(299 * 12 * 0.84), desc: '3 domains, 25 mailboxes', features: ['3 Custom Domains', '25 Mailboxes', 'Queue Monitoring', 'Email Support', 'Basic Templates'] },
  { id: 'business', name: 'Business', priceMonthly: 999, priceAnnual: Math.round(999 * 12 * 0.84), desc: '10 domains, unlimited mailboxes', features: ['10 Custom Domains', 'Unlimited Mailboxes', 'Priority Queue', 'Advanced Templates', 'Team Access', 'Audit Logs', 'Priority Support'] },
  { id: 'enterprise', name: 'Enterprise', priceMonthly: 2499, priceAnnual: Math.round(2499 * 12 * 0.84), desc: 'Unlimited domains & users', features: ['Unlimited Domains', 'Unlimited Mailboxes', 'Dedicated Queue', 'Custom Templates', 'Bulk Operations', 'SLA Guarantee', 'Phone Support', 'White Label'] },
];

export const ROLE_ALLOWED_TABS: Record<string, BizTab[]> = {
  admin: ['mail', 'templates', 'queue', 'domains', 'mailboxes', 'groups', 'team', 'analytics', 'audit', 'settings', 'billing', 'admin', 'contacts', 'deliverability'],
  member: ['mail', 'templates', 'queue', 'analytics', 'team', 'domains', 'mailboxes', 'groups', 'audit', 'settings', 'billing', 'contacts', 'deliverability'],
  viewer: ['mail', 'analytics', 'team', 'domains', 'mailboxes', 'groups', 'audit', 'settings', 'billing', 'contacts', 'deliverability'],
};
