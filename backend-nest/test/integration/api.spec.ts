import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';

describe('API integration', () => {
  let app: INestApplication;
  let accessToken: string;
  const authService = {
    loginWithTelegram: jest.fn().mockResolvedValue({ accessToken: 'mock-access', refreshToken: 'mock-refresh' }),
    refresh: jest.fn(),
    logout: jest.fn(),
  };
  const prisma = {
    authSession: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { status: UserStatus.ACTIVE },
      }),
      update: jest.fn(),
    },
    userProfile: {
      update: jest.fn().mockResolvedValue({ id: 'profile-1', userId: 'user-1' }),
    },
    auditLog: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        telegramId: BigInt(123),
        firstName: 'Test',
        lastName: null,
        telegramUsername: null,
        telegramPhotoUrl: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastLoginAt: null,
        profile: { userId: 'user-1', equipment: [], trainingPreferences: [], notificationDays: [] },
        roles: [{ role: { code: 'USER' } }],
      }),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaClient).useValue(prisma)
      .overrideProvider(AuthService).useValue(authService)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: errors.map((error) => ({ field: error.property, constraints: error.constraints })),
      }),
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    accessToken = moduleRef.get(JwtService).sign({ sub: 'user-1', sessionId: 'session-1', roles: ['USER'] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects protected endpoints without a bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('UNAUTHORIZED'));
  });

  it('returns only the authenticated user from GET /me', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.user.id).toBe('user-1');
    expect(response.body.data.user.telegramId).toBe('123');
  });

  it('rejects protected profile fields with a validation error', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ roles: ['ADMIN'] })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));
  });

  it('supports refresh and logout for the current session', async () => {
    authService.refresh.mockResolvedValueOnce({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
      expiresIn: 900,
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'mock-refresh' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          accessToken: 'rotated-access',
          refreshToken: 'rotated-refresh',
        });
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    expect(authService.logout).toHaveBeenCalledWith('session-1', 'user-1');
  });

  it('applies the stricter Telegram login throttle', async () => {
    authService.loginWithTelegram.mockClear();

    const responses = await Promise.all(
      Array.from({ length: 11 }, () => request(app.getHttpServer())
        .post('/api/v1/auth/telegram')
        .send({ initData: 'test-init-data' })),
    );

    const limitedResponses = responses.filter((response) => response.status === 429);
    expect(limitedResponses).not.toHaveLength(0);
     expect(limitedResponses[0].body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
