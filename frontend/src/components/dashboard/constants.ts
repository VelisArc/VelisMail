import { Inbox, Shield, Mail, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type BizTab = 'mail' | 'domains' | 'mailboxes' | 'groups' | 'team' | 'queue' | 'analytics' | 'audit' | 'templates' | 'settings' | 'billing' | 'admin';

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

export const ROLE_ALLOWED_TABS: Record<string, BizTab[]> = {
  admin: ['mail', 'templates', 'queue', 'domains', 'mailboxes', 'groups', 'team', 'analytics', 'audit', 'settings', 'billing', 'admin'],
  member: ['mail', 'templates', 'queue', 'analytics', 'team'],
  viewer: ['mail', 'analytics', 'team'],
};
