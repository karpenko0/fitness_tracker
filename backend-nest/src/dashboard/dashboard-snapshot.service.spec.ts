import { DashboardSnapshotService } from './dashboard-snapshot.service';

describe('DashboardSnapshotService', () => {
  const snapshot = { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() };
  const service = new DashboardSnapshotService({ dashboardSnapshot: snapshot } as any);

  beforeEach(() => jest.clearAllMocks());

  it('does not read the database when force refresh is requested', async () => {
    await expect(service.get('u', '2026-09-06', 'UTC', 'ru', true)).resolves.toBeNull();
    expect(snapshot.findUnique).not.toHaveBeenCalled();
  });

  it('rejects expired and invalidated snapshots', async () => {
    snapshot.findUnique.mockResolvedValueOnce({ status: 'EXPIRED', expiresAt: new Date(Date.now() + 1000) });
    await expect(service.get('u', '2026-09-06', 'UTC', 'ru')).resolves.toBeNull();
    snapshot.findUnique.mockResolvedValueOnce({ status: 'ACTIVE', expiresAt: new Date(Date.now() - 1000) });
    await expect(service.get('u', '2026-09-06', 'UTC', 'ru')).resolves.toBeNull();
  });

  it('invalidates only active snapshots for the owner', async () => {
    snapshot.updateMany.mockResolvedValue({ count: 2 });
    await service.invalidate('u', 'workout_changed');
    expect(snapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u', status: 'ACTIVE' } }));
  });

  it('fails instead of overwriting a snapshot with a stale version', async () => {
    snapshot.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save('u', '2026-09-06', 'UTC', 'ru', {}, 1n, 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DASHBOARD_SNAPSHOT_CONFLICT' }) });
    expect(snapshot.findUnique).not.toHaveBeenCalled();
  });

  it('does not increment a snapshot version during a regular refresh', async () => {
    snapshot.upsert.mockResolvedValue({ snapshotData: {}, expiresAt: new Date('2026-09-06T00:05:00Z'), version: 1 });

    await service.save('u', '2026-09-06', 'UTC', 'ru', {});

    expect(snapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({ version: expect.anything() }),
    }));
  });
});
