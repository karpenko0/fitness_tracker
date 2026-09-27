import { INestApplication, ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { PrismaClient } from '@prisma/client';
import request = require('supertest');
import { ProgressComparisonController } from '../../src/progress-comparison/progress-comparison.controller';
import { ProgressComparisonService } from '../../src/progress-comparison/progress-comparison.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';

/**
 * HTTP-интеграция сравнения периодов: реальные контроллер/сервис/фильтр/интерцептор, Prisma — мок.
 * Доступ Pro определяется подпиской (SPEC-010), а не legacy subscription_entitlements.
 */
describe('GET /api/v1/progress-comparison (HTTP)', () => {
  let app: INestApplication;
  const prisma: any = {
    progressAggregate: { findMany: jest.fn() },
    subscription: { findFirst: jest.fn() },
    subscriptionEntitlement: { findUnique: jest.fn() },
  };
  const agg = (values: number[]) => values.map((value, i) => ({ localDate: new Date(Date.UTC(2026, 8, 1 + i)), value }));
  const proSubscription = { id: 's1', tier: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86_400_000) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProgressComparisonController],
      providers: [ProgressComparisonService, { provide: PrismaClient, useValue: prisma }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: (ctx: ExecutionContext) => { ctx.switchToHttp().getRequest().user = { userId: 'user-1', roles: ['USER'] }; return true; } })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.subscription.findFirst.mockResolvedValue(null);
  });

  it('week over week VOLUME: sums, absolute/percent change, trend UP', async () => {
    prisma.progressAggregate.findMany
      .mockResolvedValueOnce(agg([1500, 1800, 2000, 2200, 1900, 1500, 1500]))
      .mockResolvedValueOnce(agg([1400, 1600, 1500, 1700, 1600, 1500, 1500]));

    const res = await request(app.getHttpServer()).get('/api/v1/progress-comparison').query({ preset: 'WEEK', metric: 'VOLUME' }).expect(200);

    expect(res.body.data).toMatchObject({ metric: 'VOLUME', unit: 'KG', currentPeriod: { value: 12400 }, previousPeriod: { value: 10800 } });
    expect(res.body.data.comparison).toMatchObject({ absoluteChange: 1600, trend: 'UP' });
    expect(res.body.data.comparison.percentChange).toBeCloseTo(14.81, 2);
    expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
  });

  it('no previous data → nulls and NEUTRAL', async () => {
    prisma.progressAggregate.findMany.mockResolvedValueOnce(agg([1500, 1800])).mockResolvedValueOnce([]);

    const res = await request(app.getHttpServer()).get('/api/v1/progress-comparison').query({ preset: 'WEEK', metric: 'VOLUME' }).expect(200);

    expect(res.body.data.currentPeriod.value).toBe(3300);
    expect(res.body.data.previousPeriod.value).toBeNull();
    expect(res.body.data.comparison).toMatchObject({ absoluteChange: null, percentChange: null, trend: 'NEUTRAL' });
  });

  it('FREE: history limited to last 30 days (query window clipped); PRO (active subscription): not clipped', async () => {
    prisma.progressAggregate.findMany.mockResolvedValue([]);
    const from = '2026-01-01';
    const to = '2026-01-31';

    await request(app.getHttpServer()).get('/api/v1/progress-comparison').query({ preset: 'CUSTOM', metric: 'VOLUME', from, to }).expect(200);
    // Весь период старше 30 дней → у FREE запросов к агрегатам нет вовсе.
    expect(prisma.progressAggregate.findMany).not.toHaveBeenCalled();

    prisma.subscription.findFirst.mockResolvedValue(proSubscription);
    await request(app.getHttpServer()).get('/api/v1/progress-comparison').query({ preset: 'CUSTOM', metric: 'VOLUME', from, to }).expect(200);
    expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
    const where = prisma.progressAggregate.findMany.mock.calls[0][0].where;
    expect(new Date(where.localDate.gte).toISOString().slice(0, 10)).toBe(from);
  });

  it('invalid preset / metric → 400 VALIDATION_ERROR (not 500)', async () => {
    const bad = await request(app.getHttpServer()).get('/api/v1/progress-comparison').query({ preset: 'YEAR', metric: 'VOLUME' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const badMetric = await request(app.getHttpServer()).get('/api/v1/progress-comparison').query({ preset: 'WEEK', metric: 'NOPE' }).expect(400);
    expect(badMetric.body.error.code).toBe('VALIDATION_ERROR');
  });
});
