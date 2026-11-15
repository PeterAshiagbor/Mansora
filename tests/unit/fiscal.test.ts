import { describe, expect, it } from 'vitest';
import { FISCAL_BACKOFF_CAP_MS, retryDelayMs, stateFromEvent, summariseFiscal } from '../../packages/domain/src';

describe('retryDelayMs', () => {
  it('doubles from 30 s, jittered to 50-100%, and is capped', () => {
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, () => 0))).toEqual([15_000, 30_000, 60_000, 120_000]);
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, () => 0.999999))).toEqual([30_000, 60_000, 120_000, 240_000].map((v) => Math.round(v * 0.9999995)));
    for (const a of [10, 50, 1000]) expect(retryDelayMs(a, () => 0.999999)).toBeLessThanOrEqual(FISCAL_BACKOFF_CAP_MS);
    expect(retryDelayMs(0, () => 0)).toBe(15_000);
  });
});

describe('document state', () => {
  it('is derived from the latest event', () => {
    expect(stateFromEvent(null)).toBe('queued');
    expect(stateFromEvent('submitted')).toBe('submitting');
    expect(stateFromEvent('retry_scheduled')).toBe('retrying');
    expect(stateFromEvent('acknowledged')).toBe('acknowledged');
    expect(stateFromEvent('rejected')).toBe('rejected');
    expect(stateFromEvent('manual_resolution')).toBe('resolved');
  });
  it('summary counts open documents and flags the ones older than the alert window', () => {
    const now = '2026-11-15T12:00:00Z';
    const s = summariseFiscal([
      { state: 'acknowledged', created_at: '2026-11-01T00:00:00Z' },
      { state: 'retrying', created_at: '2026-11-14T10:00:00Z' },
      { state: 'waiting', created_at: '2026-11-15T11:00:00Z' },
      { state: 'rejected', created_at: '2026-11-10T00:00:00Z' },
      { state: 'resolved', created_at: '2026-11-10T00:00:00Z' },
    ], now);
    expect(s).toEqual({ total: 5, acknowledged: 1, pending: 2, rejected: 1, resolved: 1, oldestUnacknowledgedAt: '2026-11-14T10:00:00Z', overdue: 1 });
  });
});
