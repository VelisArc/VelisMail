import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './client-core';

describe('apiErrorMessage', () => {
  it('reads the gateway nested error message', () => {
    expect(
      apiErrorMessage(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'A valid bearer token is required.' } },
        'fallback',
      ),
    ).toBe('A valid bearer token is required.');
  });

  it('reads legacy string errors and top-level messages', () => {
    expect(apiErrorMessage({ success: false, error: 'Domain is already connected.' }, 'fallback')).toBe(
      'Domain is already connected.',
    );
    expect(apiErrorMessage({ message: 'Mailbox not found.' }, 'fallback')).toBe('Mailbox not found.');
  });

  it('never renders an object as the message', () => {
    const message = apiErrorMessage({ error: { code: 'FORBIDDEN' } }, 'Request failed.');
    expect(message).toBe('FORBIDDEN');
    expect(message).not.toContain('[object Object]');
  });

  it('falls back when the payload has no readable message', () => {
    expect(apiErrorMessage(null, 'Request failed.')).toBe('Request failed.');
    expect(apiErrorMessage('', 'Request failed.')).toBe('Request failed.');
    expect(apiErrorMessage({ error: {} }, 'Request failed.')).toBe('Request failed.');
  });
});
