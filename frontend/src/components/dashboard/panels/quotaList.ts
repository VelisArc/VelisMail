import type { CompanyOverview } from '../../../api/admin';

export type CompanyQuota = CompanyOverview['quotas'][number];

/**
 * Older gateways returned quotas as an object keyed by allowance name. Accept
 * both shapes so a frontend deploy never crashes against an older backend.
 */
export function normalizeQuotas(value: unknown): CompanyQuota[] {
  if (Array.isArray(value)) return value as CompanyQuota[];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, Omit<CompanyQuota, 'key'>>).map(([key, quota]) => ({
      key,
      ...quota,
    }));
  }
  return [];
}
