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
  const prisma: any = {
    authSession: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { status: UserStatus.ACTIVE },
      }),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    exerciseCatalogItem: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    starterProgram: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    userProgramAssignment: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    subscriptionEntitlement: {
      findUnique: jest.fn().mockResolvedValue({ plan: 'FREE', maxDraftCustomPrograms: 2, maxActiveCustomPrograms: 1, maxCustomExercises: 10 }),
    },
    userProfile: {
      update: jest.fn().mockResolvedValue({ id: 'profile-1', userId: 'user-1' }),
      findUnique: jest.fn().mockResolvedValue({ limitationTags: [] }),
    },
    workout: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    workoutCalculation: {
      findFirst: jest.fn().mockResolvedValue(null),
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
    idempotencyKey: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    programWorkout: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      delete: jest.fn(),
    },
    programWorkoutExercise: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    programExerciseSet: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    $executeRaw: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE', maxDraftCustomPrograms: 2, maxActiveCustomPrograms: 1, maxCustomExercises: 10 });
    prisma.starterProgram.findMany.mockResolvedValue([]);
    prisma.starterProgram.findUnique.mockImplementation((args: any) => { if (args?.where?.id) return Promise.resolve({ id: args.where.id, ownerId: 'user-1', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] }); return Promise.resolve(null); });
    prisma.starterProgram.create.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    prisma.userProgramAssignment.findFirst.mockResolvedValue(null);
    prisma.workout.findFirst.mockResolvedValue(null);
    prisma.programWorkout.findMany.mockResolvedValue([]);
    prisma.programWorkoutExercise.findMany.mockResolvedValue([]);
    prisma.programExerciseSet.findMany.mockResolvedValue([]);
    prisma.exerciseCatalogItem.findUnique.mockResolvedValue(null);
    prisma.exerciseCatalogItem.findMany.mockResolvedValue([]);
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

  it('requires a bearer token for progression endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/progression/exercises/01900000-0000-7000-8000-000000000001')
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('UNAUTHORIZED'));
  });

  it('scopes progression reads to the authenticated user and returns EXERCISE_NOT_FOUND for unknown catalog ids', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/progression/exercises/01900000-0000-7000-8000-000000000001')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('EXERCISE_NOT_FOUND'));
  });

  it('requires a bearer token for program and exercise catalog endpoints', async () => {
    await request(app.getHttpServer()).get('/api/v1/programs').expect(401).expect(({ body }) => expect(body.error.code).toBe('UNAUTHORIZED'));
    await request(app.getHttpServer()).get('/api/v1/exercises').expect(401).expect(({ body }) => expect(body.error.code).toBe('UNAUTHORIZED'));
    await request(app.getHttpServer()).get('/api/v1/programs/me/active').expect(401);
  });

  it('returns an empty active program payload and paginated catalogs for the authenticated user', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/programs/me/active')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.activeProgram).toBeNull());

    await request(app.getHttpServer())
      .get('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items).toEqual([]);
        expect(body.data.hasMore).toBe(false);
      });

    await request(app.getHttpServer())
      .get('/api/v1/exercises')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.items).toEqual([]));
  });

  it('rejects unknown fields and missing idempotency keys on program writes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Моя программа', unknown: true })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    await request(app.getHttpServer())
      .post('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Моя программа', description: '4 тренировки', goal: 'MUSCLE_GAIN', level: 'INTERMEDIATE', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 })
      .expect(({ body, status }) => {
        expect([400, 409]).toContain(status);
        expect(['IDEMPOTENCY_KEY_REQUIRED', 'VALIDATION_ERROR']).toContain(body.error.code);
      });
  });

  it('forbids USER from admin progression and SUPER_ADMIN-only recalculation', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/progression/users/01900000-0000-7000-8000-000000000002/exercises/01900000-0000-7000-8000-000000000001')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FORBIDDEN'));

    await request(app.getHttpServer())
      .post('/api/v1/progression/workouts/01900000-0000-7000-8000-000000000003/recalculate')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', '01900000-0000-7000-8000-000000000099')
      .send({ algorithmVersion: 'PROGRESSION_V1', reason: 'DATA_CORRECTION' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FORBIDDEN'));
  });

  it('GET /programs returns paginated catalog', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toHaveProperty('items'));
  });

  it('GET /programs/me/active returns null when no active program', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/programs/me/active')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.activeProgram).toBeNull());
  });

  it('POST /programs creates a program with idempotency key', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'unique-key-1')
      .send({ title: 'Test Program', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 })
      .expect(({ body, status }) => {
        expect([200, 201]).toContain(status);
        expect(body.data).toHaveProperty('program');
      });
  });

  it('POST /programs without idempotency key returns error', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Test Program', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 })
      .expect(({ body, status }) => {
        expect([400, 409]).toContain(status);
        expect(['IDEMPOTENCY_KEY_REQUIRED', 'VALIDATION_ERROR']).toContain(body.error.code);
      });
  });

  it('GET /exercises returns paginated catalog', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/exercises')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toHaveProperty('items'));
  });

  it('RBAC: user cannot access another user program', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/programs/01900000-0000-7000-8000-000000000099')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('Free user cannot activate Pro program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'user-1', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [], isProOnly: true });
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE' });
    await request(app.getHttpServer())
      .post('/api/v1/programs/p1/activate')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'activate-key-1')
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('PRO_FEATURE_REQUIRED'));
  });

  it('idempotent POST does not create duplicates', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'idem-key-2')
      .send({ title: 'Idempotent Program', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 });
    const res2 = await request(app.getHttpServer())
      .post('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'idem-key-2')
      .send({ title: 'Idempotent Program', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 });
    expect(res1.body.data).toEqual(res2.body.data);
  });

  it('version conflict returns 409', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'user-1', type: 'USER_CUSTOM', status: 'DRAFT', version: 5, workouts: [] });
    await request(app.getHttpServer())
      .patch('/api/v1/programs/p1')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'version-key-1')
      .send({ version: 3, title: 'Updated' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('PROGRAM_VERSION_CONFLICT'));
  });

it('Free user cannot exceed active program limit', async () => {
     prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'user-1', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
     prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE', maxActiveCustomPrograms: 1 });
     prisma.starterProgram.count.mockResolvedValue(1);
     await request(app.getHttpServer())
       .post('/api/v1/programs/p1/activate')
       .set('Authorization', `Bearer ${accessToken}`)
       .set('Idempotency-Key', 'limit-key-1')
       .expect(403)
       .expect(({ body }) => expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED'));
   });

  it('Pro user can create multiple programs', async () => {
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'PRO', maxDraftCustomPrograms: 5, maxActiveCustomPrograms: 5, maxCustomExercises: 50 });
    prisma.starterProgram.count.mockResolvedValue(0);
    await request(app.getHttpServer())
      .post('/api/v1/programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'pro-key-1')
      .send({ title: 'Pro Program', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 })
      .expect(201);
  });

it('exercise catalog supports search and filtering', async () => {
     prisma.exerciseCatalogItem.findMany.mockResolvedValue([
       { id: 'e1', title: 'Squat', primaryMuscles: ['QUADRICEPS'], equipmentList: ['BARBELL'], isProOnly: false, active: true },
     ]);
     await request(app.getHttpServer())
       .get('/api/v1/exercises?q=Squat&primaryMuscle=QUADRICEPS')
       .set('Authorization', `Bearer ${accessToken}`)
       .expect(200)
       .expect(({ body }) => expect(body.data.items.length).toBeGreaterThanOrEqual(0));
   });

  it('unknown exercise returns 404', async () => {
    prisma.exerciseCatalogItem.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/api/v1/exercises/01900000-0000-7000-8000-000000000099')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('EXERCISE_NOT_FOUND'));
  });

it('audit logs do not contain tokens or stack traces', async () => {
     await request(app.getHttpServer())
       .post('/api/v1/programs')
       .set('Authorization', `Bearer ${accessToken}`)
       .set('Idempotency-Key', 'audit-key-1')
       .send({ title: 'Audit Test', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 });
     expect(prisma.auditLog.create).toHaveBeenCalled();
     const call = prisma.auditLog.create.mock.calls[0];
     const metadata = JSON.stringify(call[0].data.metadata);
     expect(metadata).not.toMatch(/access_token|refresh_token|initData|stack trace/i);
   });
});
