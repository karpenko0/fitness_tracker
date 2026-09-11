import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DashboardRedisService } from './redis.service';

@Injectable()
export class ForceRefreshLimitService {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly redis?: DashboardRedisService) {}

  async check(userId: string, now = Date.now()) {
    if (this.redis) {
      const count = await this.redis.increment(`dashboard:force-refresh:${userId}`, 60);
      if (count > 5) throw new HttpException({ code: 'RATE_LIMIT_EXCEEDED', message: 'Force refresh rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
      return;
    }
    const current = this.windows.get(userId);
    if (!current || now - current.startedAt >= 60_000) {
      this.windows.set(userId, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= 5) {
      throw new HttpException({ code: 'RATE_LIMIT_EXCEEDED', message: 'Force refresh rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    current.count += 1;
  }
}
