import { describe, expect, it } from 'vitest';
import {
  getConnectionHostLabel,
  getMailProviderKeyMismatch,
  inferDatabaseProviderFromUrl,
  inferMailProviderFromApiKey,
  isValidDatabaseUrl,
} from './providers';

describe('provider configuration helpers', () => {
  it('accepts only supported database URL schemes', () => {
    expect(isValidDatabaseUrl('postgresql://user:pass@example.com/app')).toBe(true);
    expect(isValidDatabaseUrl('rediss://default:pass@example.com:6380')).toBe(true);
    expect(isValidDatabaseUrl('javascript:alert(1)')).toBe(false);
    expect(isValidDatabaseUrl('https://example.com/db')).toBe(false);
  });

  it('infers common provider types without exposing credentials', () => {
    expect(inferDatabaseProviderFromUrl('postgresql://u:p@db.project.supabase.co/postgres')).toBe('supabase');
    expect(inferDatabaseProviderFromUrl('mongodb+srv://u:p@cluster.mongodb.net/app')).toBe('mongodb_atlas');
    expect(getConnectionHostLabel('postgresql://user:secret@host.example.com:5432/app')).toBe('host.example.com:5432');
  });

  it('detects mail API key/provider mismatches', () => {
    expect(inferMailProviderFromApiKey('SG.secret')).toBe('sendgrid');
    expect(getMailProviderKeyMismatch('resend', 'SG.secret')).toContain('SendGrid');
    expect(getMailProviderKeyMismatch('sendgrid', 'SG.secret')).toBeNull();
  });
});
