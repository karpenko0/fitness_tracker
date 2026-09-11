import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('DashboardController contract', () => {
  let app: INestApplication;
  const dashboard = { get: jest.fn().mockResolvedValue({ meta: { localDate: '2026-09-09' } }) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [DashboardController], providers: [{ provide: DashboardService, useValue: dashboard }] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => { context.switchToHttp().getRequest().user = { userId: 'u', roles: ['USER'] }; return true; } }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: errors => new BadRequestException({ code: 'VALIDATION_ERROR', details: errors }) }));
    await app.init();
  });
  afterAll(() => app.close());

  it('passes normalized headers and forceRefresh to the service', async () => {
    await request(app.getHttpServer()).get('/api/v1/dashboard?forceRefresh=true').set('X-Timezone', 'Europe/Moscow').expect(200);
    expect(dashboard.get).toHaveBeenCalledWith('u', 'Europe/Moscow', undefined, true, expect.stringMatching(/^req_/));
  });

  it('rejects unknown query parameters', async () => {
    await request(app.getHttpServer()).get('/api/v1/dashboard?unexpected=true').expect(400);
  });
});
