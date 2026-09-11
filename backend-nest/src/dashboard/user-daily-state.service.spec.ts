import { UserDailyStateService } from './user-daily-state.service';

describe('UserDailyStateService', () => {
  it('rejects a stale optimistic-lock version', async () => {
    const dailyState = { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUniqueOrThrow: jest.fn() };
    const service = new UserDailyStateService({ userDailyState: dailyState } as any);
    await expect(service.save('u', '2026-09-06', 'UTC', 'REST_DAY', 'REST_DAY', {}, { completed: 0, planned: 0 }, 2)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'USER_DAILY_STATE_CONFLICT' }) });
    expect(dailyState.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
