import { DashboardService } from './dashboard.service';

describe('DashboardService snapshots', () => {
  const user = { id: 'user-1', status: 'ACTIVE', profile: { timezone: 'UTC', locale: 'ru' } };
  const snapshotData = {
    meta: { snapshotVersion: 1, cache: { hit: false, expiresAt: '2026-09-11T00:05:00.000Z' } },
    primaryAction: { type: 'REST_DAY' },
  };

  function createService(snapshot: any) {
    return new DashboardService(
      { user: { findUnique: jest.fn().mockResolvedValue(user) } } as any,
      { aggregate: jest.fn() } as any,
      { get: jest.fn().mockResolvedValue(snapshot), save: jest.fn() } as any,
      { resolve: jest.fn().mockReturnValue({ timezone: 'UTC', source: 'header' }), localDate: jest.fn().mockReturnValue('2026-09-11') } as any,
      { event: jest.fn() } as any,
      {} as any,
      { check: jest.fn() } as any,
    );
  }

  it('returns cache metadata without mutating persisted snapshot data', async () => {
    const expiresAt = new Date('2026-09-11T00:05:00.000Z');
    const service = createService({ snapshotData, version: 4, expiresAt });

    await expect(service.get('user-1', 'UTC', 'ru', false, 'request-1')).resolves.toMatchObject({
      meta: { snapshotVersion: 4, cache: { hit: true, expiresAt: expiresAt.toISOString() } },
    });
    expect(snapshotData).toEqual({
      meta: { snapshotVersion: 1, cache: { hit: false, expiresAt: '2026-09-11T00:05:00.000Z' } },
      primaryAction: { type: 'REST_DAY' },
    });
  });
});
