import { Injectable } from '@nestjs/common';
import { DashboardRedisService } from '../dashboard/redis.service';

@Injectable()
export class ProgressionCacheService {
  constructor(private readonly redis: DashboardRedisService) {}
  private key(userId: string, suffix: string) { return `progression:${userId}:${suffix}`; }
  async get<T>(userId: string, suffix: string): Promise<T | null> {
    const value = await this.redis.get(this.key(userId, suffix));
    if (!value) return null;
    try { return JSON.parse(value) as T; } catch { await this.redis.del(this.key(userId, suffix)); return null; }
  }
  async set(userId: string, suffix: string, value: unknown, ttlSeconds = 300) { await this.redis.set(this.key(userId, suffix), JSON.stringify(value), ttlSeconds); }
  async invalidateUser(userId: string) { await this.redis.delByPrefix(`progression:${userId}:`); }
}
