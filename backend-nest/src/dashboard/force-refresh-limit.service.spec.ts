import { ForceRefreshLimitService } from './force-refresh-limit.service';

describe('ForceRefreshLimitService', () => {
  it('allows five requests and rejects the sixth in a minute', async () => {
    const service = new ForceRefreshLimitService();
    for (let i = 0; i < 5; i += 1) await service.check('user', 1000);
    await expect(service.check('user', 1000)).rejects.toThrow('Force refresh rate limit exceeded');
    await expect(service.check('user', 61_000)).resolves.toBeUndefined();
  });
});
