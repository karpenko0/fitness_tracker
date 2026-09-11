import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class DashboardRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('dashboard.redis');
  private client?: Redis;
  private fallback = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}
  onModuleInit() { const url = this.config.get<string>('REDIS_URL'); if (url) { this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false }); void this.client.connect().catch(error => { if (this.config.get<string>('REDIS_REQUIRED') === 'true') throw error; this.logger.warn(`Redis unavailable: ${error.message}`); }); } else if (this.config.get<string>('REDIS_REQUIRED') === 'true') { throw new Error('REDIS_URL is required when REDIS_REQUIRED=true'); } }
  async onModuleDestroy() { if (this.client) await this.client.quit().catch(() => undefined); }
  async get(key: string) { try { if (this.client?.status === 'ready') return await this.client.get(key); } catch (error: any) { this.logger.warn(`Redis get failed: ${error.message}`); } const item = this.fallback.get(key); if (!item || item.expiresAt <= Date.now()) { this.fallback.delete(key); return null; } return item.value; }
  async set(key: string, value: string, ttlSeconds: number) { try { if (this.client?.status === 'ready') { await this.client.set(key, value, 'EX', ttlSeconds); return; } } catch (error: any) { this.logger.warn(`Redis set failed: ${error.message}`); } this.fallback.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 }); }
  async del(key: string) { try { if (this.client?.status === 'ready') await this.client.del(key); } catch (error: any) { this.logger.warn(`Redis del failed: ${error.message}`); } this.fallback.delete(key); }
  async delByPrefix(prefix: string) { for (const key of [...this.fallback.keys()]) if (key.startsWith(prefix)) this.fallback.delete(key); if (!this.client || this.client.status !== 'ready') return; try { let cursor = '0'; do { const result = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100); cursor = result[0]; if (result[1].length) await this.client.del(...result[1]); } while (cursor !== '0'); } catch (error: any) { this.logger.warn(`Redis prefix delete failed: ${error.message}`); } }
  async increment(key: string, ttlSeconds: number) { try { if (this.client?.status === 'ready') { const count = await this.client.incr(key); if (count === 1) await this.client.expire(key, ttlSeconds); return count; } } catch (error: any) { this.logger.warn(`Redis increment failed: ${error.message}`); } const current = this.fallback.get(key); const count = current && current.expiresAt > Date.now() ? Number(current.value) + 1 : 1; this.fallback.set(key, { value: String(count), expiresAt: Date.now() + ttlSeconds * 1000 }); return count; }
}
