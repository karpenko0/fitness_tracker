import { BadRequestException, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../../src/auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../../src/common/interceptors/transform.interceptor';
import { RefundService } from '../../../src/subscription/refund.service';
import { AdminPaymentsController, SubscriptionController, TelegramWebhookController } from '../../../src/subscription/subscription.controller';
import { SubscriptionMetrics } from '../../../src/subscription/subscription.observability';
import { SubscriptionService } from '../../../src/subscription/subscription.service';
import { TelegramWebhookService } from '../../../src/subscription/telegram-webhook.service';
import { buildHarness, WEBHOOK_SECRET } from './harness';

describe('SPEC-010 HTTP contract', () => {
  let app: INestApplication;
  let h: ReturnType<typeof buildHarness>;
  let current: { userId: string; roles: string[] } | null;

  beforeEach(async () => {
    h = buildHarness();
    const moduleRef = await Test.createTestingModule({
      controllers: [SubscriptionController, AdminPaymentsController, TelegramWebhookController],
      providers: [
        { provide: SubscriptionService, useValue: h.subscriptions },
        { provide: RefundService, useValue: h.refunds },
        { provide: TelegramWebhookService, useValue: h.webhooks },
        { provide: SubscriptionMetrics, useValue: h.metrics },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!current) throw new (require('@nestjs/common').UnauthorizedException)({ code: 'UNAUTHORIZED', message: 'Access token is missing or invalid' });
          ctx.switchToHttp().getRequest().user = { ...current, sessionId: 's' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: errors => new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Request validation failed', details: errors.map(e => ({ field: e.property })) }) }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('401 without token', async () => {
    current = null;
    const res = await request(app.getHttpServer()).get('/api/v1/subscriptions/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /subscriptions/me wraps in { data }', async () => {
    const u = h.addUser();
    current = { userId: u.userId, roles: ['USER'] };
    const res = await request(app.getHttpServer()).get('/api/v1/subscriptions/me').expect(200);
    expect(res.body.data).toMatchObject({ effectiveTier: 'FREE', entitlements: [] });
  });

  it('POST /subscriptions/invoices rejects client amountStars/currency/paid (unknown fields)', async () => {
    const u = h.addUser();
    current = { userId: u.userId, roles: ['USER'] };
    const res = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/invoices')
      .set('Idempotency-Key', '5d745c5e-7d9d-41c9-8b00-1c2de2d0fb22')
      .send({ planCode: 'PRO_MONTHLY', amountStars: 1, currency: 'USD', paid: true })
      .expect(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) });
    expect(h.prisma.tables.payment).toHaveLength(0);
  });

  it('POST /subscriptions/invoices → 201, error envelope for 409 reuse', async () => {
    const u = h.addUser();
    current = { userId: u.userId, roles: ['USER'] };
    const k = '5d745c5e-7d9d-41c9-8b00-1c2de2d0fb22';
    const ok = await request(app.getHttpServer()).post('/api/v1/subscriptions/invoices').set('Idempotency-Key', k).send({ planCode: 'PRO_MONTHLY' }).expect(201);
    expect(ok.body.data).toMatchObject({ amountStars: 399, currency: 'XTR', status: 'PENDING' });
    const conflict = await request(app.getHttpServer()).post('/api/v1/subscriptions/invoices').set('Idempotency-Key', k).send({ planCode: 'PRO_QUARTERLY' }).expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const noKey = await request(app.getHttpServer()).post('/api/v1/subscriptions/invoices').send({ planCode: 'PRO_MONTHLY' }).expect(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('admin refund endpoint requires admin role', async () => {
    const u = h.addUser();
    current = { userId: u.userId, roles: ['USER'] };
    await request(app.getHttpServer()).post('/api/v1/admin/payments/0192a000-0000-4000-8000-000000000001/refund').set('Idempotency-Key', 'k'.repeat(20)).send({ reason: 'DUPLICATE_CHARGE' }).expect(403);
  });

  it('webhook works without JWT and hides failure reasons', async () => {
    current = null;
    const bad = await request(app.getHttpServer()).post('/api/v1/webhooks/telegram/not-the-secret').send({ update_id: 1 }).expect(404);
    expect(bad.text).toBe('');
    await request(app.getHttpServer()).post(`/api/v1/webhooks/telegram/${WEBHOOK_SECRET}`).send({ update_id: 7, message: { text: 'hi' } }).expect(200);
    expect(h.prisma.tables.telegramWebhookEvent[0]).toMatchObject({ status: 'IGNORED', eventType: 'unsupported' });
  });
});
