import { DashboardRedisService } from './redis.service';

describe('DashboardRedisService fallback cache', () => {
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new DashboardRedisService(config as any);

  it('stores values in the fallback when Redis is not configured', async () => {
    await service.set('dashboard:u:today', '{"ok":true}', 60);
    await expect(service.get('dashboard:u:today')).resolves.toBe('{"ok":true}');
  });

  it('deletes every local key matching an invalidated user prefix', async () => {
    await service.set('dashboard:user-a:one', '1', 60);
    await service.set('dashboard:user-a:two', '2', 60);
    await service.set('dashboard:user-b:one', '3', 60);
    await service.delByPrefix('dashboard:user-a:');
    await expect(service.get('dashboard:user-a:one')).resolves.toBeNull();
    await expect(service.get('dashboard:user-b:one')).resolves.toBe('3');
  });

  it('implements atomic counter semantics in fallback mode', async () => {
    await expect(service.increment('limit:user', 60)).resolves.toBe(1);
    await expect(service.increment('limit:user', 60)).resolves.toBe(2);
  });

  it('expires fallback entries', async () => {
    await service.set('short', 'value', 1);
    await expect(service.get('short')).resolves.toBe('value');
  });
});
