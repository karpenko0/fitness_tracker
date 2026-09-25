// Integration tests for the progress comparison endpoint (GET /api/v1/progress-comparison).
// Harness follows the same pattern as src/dashboard/dashboard.controller.spec.ts:
// real controller + real service, mocked PrismaClient, JWT guard overridden.
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { ProgressComparisonController } from '../../src/progress-comparison/progress-comparison.controller';
import { ProgressComparisonService } from '../../src/progress-comparison/progress-comparison.service';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';

describe('Progress comparison endpoints', () => {
  let app: INestApplication;
  const accessToken = 'test-token';

  const prisma: any = {
    progressAggregate: { findMany: jest.fn() },
    subscriptionEntitlement: { findUnique: jest.fn() },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProgressComparisonController],
      providers: [ProgressComparisonService, { provide: PrismaClient, useValue: prisma }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { userId: 'u', roles: ['USER'] };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => new BadRequestException({ code: 'VALIDATION_ERROR', details: errors }),
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue(null);
    prisma.progressAggregate.findMany.mockResolvedValue([]);
  });

  it('should compare week over week for volume', async () => {
    // Current week daily aggregates - sum = 12400
    // Previous week daily aggregates - sum = 10800
    prisma.progressAggregate.findMany
      .mockResolvedValueOnce([
        { value: 1500 }, { value: 1800 }, { value: 2000 }, { value: 2200 },
        { value: 1900 }, { value: 1500 }, { value: 1500 },
      ])
      .mockResolvedValueOnce([
        { value: 1500 }, { value: 1600 }, { value: 1700 }, { value: 2000 },
        { value: 1500 }, { value: 1500 }, { value: 1000 },
      ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/progress-comparison')
      .query({ preset: 'WEEK', metric: 'VOLUME' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveProperty('metric', 'VOLUME');
    expect(response.body.data).toHaveProperty('unit', 'KG');
    expect(response.body.data.currentPeriod).toHaveProperty('value', 12400);
    expect(response.body.data.previousPeriod).toHaveProperty('value', 10800);
    expect(response.body.data.comparison).toHaveProperty('absoluteChange', 1600);
    expect(response.body.data.comparison).toHaveProperty('percentChange');
    expect(response.body.data.comparison.percentChange).toBeCloseTo(14.81, 2);
    expect(response.body.data.comparison).toHaveProperty('trend', 'UP');
    expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
  });

  it('should handle comparison with no previous period data', async () => {
    prisma.progressAggregate.findMany
      .mockResolvedValueOnce([
        { value: 1500 }, { value: 1800 },
      ]) // Current period - sum = 3300
      .mockResolvedValueOnce([]); // Previous period - no data

    const response = await request(app.getHttpServer())
      .get('/api/v1/progress-comparison')
      .query({ preset: 'WEEK', metric: 'VOLUME' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveProperty('metric', 'VOLUME');
    expect(response.body.data).toHaveProperty('unit', 'KG');
    expect(response.body.data.currentPeriod).toHaveProperty('value', 3300);
    expect(response.body.data.previousPeriod).toHaveProperty('value', null);
    expect(response.body.data.comparison).toHaveProperty('absoluteChange', null);
    expect(response.body.data.comparison).toHaveProperty('percentChange', null);
    expect(response.body.data.comparison).toHaveProperty('trend', 'NEUTRAL');
    expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
  });

  it('should respect Free/Pro restrictions for progress comparison (Free user limited to last 30 days)', async () => {
    const recentAggregates = [
      { value: 1500 }, { value: 1800 }, { value: 2000 }, // Sum = 5300
    ];
    const oldAggregates = [
      { value: 1000 }, { value: 1100 }, { value: 1200 }, // Sum = 3300
    ];

    // FREE user: only recent aggregates are returned by the data layer
    prisma.subscriptionEntitlement.findUnique.mockResolvedValueOnce({ plan: 'FREE' });
    prisma.progressAggregate.findMany
      .mockResolvedValueOnce(recentAggregates) // Current period
      .mockResolvedValueOnce(recentAggregates); // Previous period (also recent)

    let response = await request(app.getHttpServer())
      .get('/api/v1/progress-comparison')
      .query({ preset: 'WEEK', metric: 'VOLUME' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveProperty('metric', 'VOLUME');
    expect(response.body.data).toHaveProperty('unit', 'KG');
    expect(response.body.data.currentPeriod).toHaveProperty('value', 5300);
    expect(response.body.data.previousPeriod).toHaveProperty('value', 5300);
    expect(response.body.data.comparison).toHaveProperty('absoluteChange', 0);
    expect(response.body.data.comparison).toHaveProperty('percentChange', 0);
    expect(response.body.data.comparison).toHaveProperty('trend', 'NEUTRAL');
    expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);

    // PRO user: full history is available
    prisma.progressAggregate.findMany.mockClear();
    prisma.subscriptionEntitlement.findUnique.mockResolvedValueOnce({ plan: 'PRO' });
    prisma.progressAggregate.findMany
      .mockResolvedValueOnce([...recentAggregates, ...oldAggregates]) // Current period: recent + old = 8600
      .mockResolvedValueOnce(oldAggregates); // Previous period: old only = 3300

    response = await request(app.getHttpServer())
      .get('/api/v1/progress-comparison')
      .query({ preset: 'WEEK', metric: 'VOLUME' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveProperty('metric', 'VOLUME');
    expect(response.body.data).toHaveProperty('unit', 'KG');
    expect(response.body.data.currentPeriod).toHaveProperty('value', 8600);
    expect(response.body.data.previousPeriod).toHaveProperty('value', 3300);
    expect(response.body.data.comparison).toHaveProperty('absoluteChange', 5300);
    expect(response.body.data.comparison).toHaveProperty('percentChange');
    expect(response.body.data.comparison.percentChange).toBeCloseTo(160.61, 2);
    expect(response.body.data.comparison).toHaveProperty('trend', 'UP');
    expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
  });
});
