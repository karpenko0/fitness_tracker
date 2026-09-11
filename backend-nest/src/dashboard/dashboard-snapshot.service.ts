import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DashboardRedisService } from './redis.service';

const VERSION = 'dashboard-v1';
@Injectable()
export class DashboardSnapshotService {
  constructor(private readonly prisma: PrismaClient, private readonly redis?: DashboardRedisService) {}
  private key(userId: string, localDate: string, timezone: string, locale: string) { return `dashboard:${userId}:${localDate}:${timezone}:${locale}:${VERSION}`; }
  async get(userId: string, localDate: string, timezone: string, locale: string, force = false) {
    if (force) return null;
    const cacheKey = this.key(userId, localDate, timezone, locale);
    const cached = await this.redis?.get(cacheKey);
    if (cached) {
      try {
        const value = JSON.parse(cached);
        if (value?.snapshotData && value?.expiresAt && value?.version) return { snapshotData: value.snapshotData, expiresAt: new Date(value.expiresAt), version: value.version } as any;
      } catch { await this.redis?.del(cacheKey); }
    }
    return this.prisma.dashboardSnapshot.findUnique({ where: { userId_localDate_timezone_locale_algorithmVersion: { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone, locale, algorithmVersion: VERSION } } }).then(async s => { const valid = s && s.status === 'ACTIVE' && s.expiresAt > new Date() ? s : null; if (valid) await this.redis?.set(cacheKey, JSON.stringify({ snapshotData: valid.snapshotData, expiresAt: valid.expiresAt.toISOString(), version: valid.version }), Math.max(1, Math.ceil((valid.expiresAt.getTime() - Date.now()) / 1000))); return valid; });
  }
  async save(userId: string, localDate: string, timezone: string, locale: string, data: object, sourceVersion = 1n, expectedVersion?: number) {
    const now = new Date();
    const key = { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone, locale, algorithmVersion: VERSION };
    if (expectedVersion === undefined) {
      const saved = await this.prisma.dashboardSnapshot.upsert({ where: { userId_localDate_timezone_locale_algorithmVersion: key }, create: { ...key, snapshotData: data, sourceVersion, generatedAt: now, expiresAt: new Date(now.getTime() + 300000), status: 'ACTIVE' }, update: { snapshotData: data, sourceVersion, generatedAt: now, expiresAt: new Date(now.getTime() + 300000), status: 'ACTIVE', invalidatedAt: null } });
      await this.redis?.set(this.key(userId, localDate, timezone, locale), JSON.stringify({ snapshotData: saved.snapshotData, expiresAt: saved.expiresAt.toISOString(), version: saved.version }), 300);
      return saved;
    }
    const result = await this.prisma.dashboardSnapshot.updateMany({ where: { ...key, version: expectedVersion }, data: { snapshotData: data, sourceVersion, generatedAt: now, expiresAt: new Date(now.getTime() + 300000), status: 'ACTIVE', invalidatedAt: null, version: { increment: 1 } } });
    if (result.count !== 1) throw new ConflictException({ code: 'DASHBOARD_SNAPSHOT_CONFLICT', message: 'Dashboard snapshot was changed concurrently' });
    return this.prisma.dashboardSnapshot.findUniqueOrThrow({ where: { userId_localDate_timezone_locale_algorithmVersion: key } });
  }
  async invalidate(userId: string, reason = 'source_changed') { const result = await this.prisma.dashboardSnapshot.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'INVALIDATED', invalidatedAt: new Date() } }); await this.redis?.delByPrefix(`dashboard:${userId}:`); return result; }
  async expire() { const expired = await this.prisma.dashboardSnapshot.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() } }, select: { userId: true } }); const result = await this.prisma.dashboardSnapshot.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } }); for (const item of expired) await this.redis?.delByPrefix(`dashboard:${item.userId}:`); return result; }
  async purge(retentionDays = 30) { return this.prisma.dashboardSnapshot.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - retentionDays * 86400000) } } }); }
}
