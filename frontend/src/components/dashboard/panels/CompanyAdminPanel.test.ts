import { describe, expect, it } from 'vitest';
import { normalizeQuotas } from './quotaList';

const quota = {
  label: 'Mail volume',
  used: 12,
  limit: 100,
  unit: 'emails',
  period: 'per month',
  source: 'Delivery engine',
};

describe('company quota normalization', () => {
  it('accepts the legacy keyed payload', () => {
    const quotas = normalizeQuotas({ emails: quota });

    expect(quotas).toHaveLength(1);
    expect(quotas[0]).toMatchObject({ key: 'emails', ...quota });
  });

  it('keeps the current list payload', () => {
    const list = [{ key: 'emails', ...quota }];

    expect(normalizeQuotas(list)).toEqual(list);
  });

  it('returns an empty list for malformed data', () => {
    expect(normalizeQuotas(null)).toEqual([]);
    expect(normalizeQuotas('not-a-quota-list')).toEqual([]);
  });
});
