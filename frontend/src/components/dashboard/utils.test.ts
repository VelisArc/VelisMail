import { describe, expect, it } from 'vitest';
import { buildForwardQuote } from './utils';
import type { Email } from '../../api/client';

const baseEmail: Email = {
  id: 'em_test',
  from: 'sender@example.com',
  fromName: 'Sender',
  to: ['me@example.com'],
  subject: 'Hello',
  body: 'Plain body',
  date: '2026-10-24T08:00:00.000Z',
  folder: 'inbox',
  unread: false,
  starred: false,
  labels: [],
  hasAttachment: false,
};

describe('buildForwardQuote', () => {
  it('keeps the mail metadata and body in the collapsed block', () => {
    const quote = buildForwardQuote(baseEmail);
    expect(quote).toContain('---------- Forwarded message ----------');
    expect(quote).toContain('From: Sender <sender@example.com>');
    expect(quote).toContain('Subject: Hello');
    expect(quote).toContain('To: me@example.com');
    expect(quote).toContain('Plain body');
  });

  it('strips HTML so a logo in the original mail is not copied into the forward', () => {
    const quote = buildForwardQuote({
      ...baseEmail,
      body: '<div>Brand message</div><img src="data:image/png;base64,AAAA" alt="logo">',
    });
    expect(quote).toContain('Brand message');
    expect(quote).not.toContain('<img');
    expect(quote).not.toContain('base64');
  });
});
