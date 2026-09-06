import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const VERSION = 'dashboard-v1';
@Injectable()
export class DashboardSnapshotService {
  constructor(private readonly prisma: PrismaClient) {}
  async get(userId: string, localDate: string, timezone: string, locale: string, force = false) {
    if (force) return null;
    return this.prisma.dashboardSnapshot.findUnique({ where: { userId_localDate_timezone_locale_algorithmVersion: { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone, locale, algorithmVersion: VERSION } } }).then(s => s && s.status === 'ACTIVE' && s.expiresAt > new Date() ? s : null);
  }
  async save(userId: string, localDate: string, timezone: string, locale: string, data: object, sourceVersion = 1n) {
    const now = new Date();
    return this.prisma.dashboardSnapshot.upsert({ where: { userId_localDate_timezone_locale_algorithmVersion: { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone, locale, algorithmVersion: VERSION } }, create: { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone, locale, algorithmVersion: VERSION, snapshotData: data, sourceVersion, generatedAt: now, expiresAt: new Date(now.getTime() + 300000), status: 'ACTIVE' }, update: { snapshotData: data, sourceVersion, generatedAt: now, expiresAt: new Date(now.getTime() + 300000), status: 'ACTIVE', invalidatedAt: null, version: { increment: 1 } } });
  }
  async invalidate(userId: string, reason = 'source_changed') { return this.prisma.dashboardSnapshot.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'INVALIDATED', invalidatedAt: new Date() } }); }
  async expire() { return this.prisma.dashboardSnapshot.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } }); }
}
