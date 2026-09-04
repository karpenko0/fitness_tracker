import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthService first-login race', () => {
  it('retries after a telegramId unique conflict outside the failed transaction', async () => {
    const existingUser = {
      id: 'user-1',
      telegramId: BigInt(123),
      firstName: 'Ivan',
      lastName: null,
      telegramUsername: null,
      telegramPhotoUrl: null,
      createdAt: new Date(),
      profile: { userId: 'user-1' },
      roles: [{ role: { code: 'USER' } }],
      status: UserStatus.ACTIVE,
    };
    let transactionCalls = 0;
    const prisma: any = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existingUser),
        create: jest.fn().mockRejectedValueOnce({ code: 'P2002', meta: { target: ['telegramId'] } }),
        update: jest.fn().mockResolvedValue(existingUser),
      },
      authSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1', refreshTokenHash: 'hash', expiresAt: new Date() }),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => {
        transactionCalls += 1;
        return callback(prisma);
      }),
    };
    const service = new AuthService(
      { sign: jest.fn().mockReturnValue('access-token') } as unknown as JwtService,
      { get: jest.fn((key: string) => ({
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: 86400,
        JWT_ACCESS_TTL_SECONDS: 900,
        REFRESH_TOKEN_TTL_DAYS: 30,
      } as Record<string, unknown>)[key]) } as any,
      { validateInitData: jest.fn().mockReturnValue({
        auth_date: `${Math.floor(Date.now() / 1000)}`,
        hash: 'valid',
        user: { id: 123, first_name: 'Ivan' },
      }) } as any,
      prisma,
    );

    const result = await service.loginWithTelegram('init-data');

    expect(result.user.id).toBe('user-1');
    expect(transactionCalls).toBe(2);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });
});
