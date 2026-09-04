import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, UserStatus, Prisma } from '@prisma/client';
import { TelegramValidationService } from './services/telegram-validation.service';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly telegramValidationService: TelegramValidationService,
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
  ) {}

  async loginWithTelegram(initData: string) {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new BadRequestException({ code: 'CONFIG_ERROR', message: 'TELEGRAM_BOT_TOKEN is not configured' });
    }
    const maxAge = Number(this.configService.get<number>('TELEGRAM_INIT_DATA_MAX_AGE_SECONDS') || 86400);

    const parsed = this.telegramValidationService.validateInitData(initData, botToken, maxAge);
    const tgUser = parsed.user;
    const telegramId = BigInt(tgUser.id);

    const loginTransaction = () => this.prisma.$transaction(async (prisma: Prisma.TransactionClient) => {
      let user = await prisma.user.findUnique({ where: { telegramId }, include: { profile: true, roles: { include: { role: true } } } });
      let isNewUser = false;

      if (!user) {
        user = await prisma.user.create({
          data: {
            telegramId,
            telegramUsername: tgUser.username,
            firstName: tgUser.first_name,
            lastName: tgUser.last_name,
            telegramLanguageCode: tgUser.language_code,
            telegramPhotoUrl: tgUser.photo_url,
            roles: {
              create: {
                role: { connect: { code: 'USER' } },
              },
            },
            profile: {
              create: {
                locale: tgUser.language_code === 'en' ? 'en' : 'ru',
                timezone: 'UTC',
              },
            },
          },
          include: { profile: true, roles: { include: { role: true } } },
        });
        isNewUser = true;

        if (user && isNewUser) {
          await prisma.auditLog.create({
            data: {
              action: 'USER_REGISTERED',
              entityType: 'User',
              entityId: user.id,
              actorUserId: user.id,
              metadata: {},
            },
          });
        }
      }

      if (!isNewUser && user) {
        if (user.status !== UserStatus.ACTIVE) {
          throw new ForbiddenException({ code: 'ACCOUNT_DELETED', message: 'Account is not active' });
        }

        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            telegramUsername: tgUser.username,
            firstName: tgUser.first_name,
            lastName: tgUser.last_name,
            telegramLanguageCode: tgUser.language_code,
            telegramPhotoUrl: tgUser.photo_url,
            lastLoginAt: new Date(),
            profile: {
              upsert: {
                create: {
                  locale: user.profile?.locale || (tgUser.language_code === 'en' ? 'en' : 'ru'),
                  timezone: 'UTC',
                },
                update: {
                  locale: user.profile?.locale || (tgUser.language_code === 'en' ? 'en' : 'ru'),
                },
              },
            },
          },
          include: { profile: true, roles: { include: { role: true } } },
        });
      }

      if (!user) {
        throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
      }

      const session = await this.createSession(prisma, user.id);
      await prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          targetUserId: user.id,
          action: 'AUTH_LOGIN_SUCCESS',
          entityType: 'AuthSession',
          entityId: session.id,
          metadata: { isNewUser },
        },
      });

      return {
        accessToken: this.signAccessToken(user.id, session.id, user.roles.map(r => r.role.code)),
        refreshToken: session.refreshToken,
        expiresIn: Number(this.configService.get<number>('JWT_ACCESS_TTL_SECONDS') || 900),
        isNewUser,
        user: {
          id: user.id,
          telegramId: user.telegramId.toString(),
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.telegramUsername,
          telegramPhotoUrl: user.telegramPhotoUrl,
          roles: user.roles.map(r => r.role.code),
          createdAt: user.createdAt,
        },
        profile: {
          userId: user.profile?.userId,
          onboardingCompleted: user.profile?.onboardingCompleted,
          locale: user.profile?.locale,
          timezone: user.profile?.timezone,
          fitnessGoal: user.profile?.fitnessGoal,
          experienceLevel: user.profile?.experienceLevel,
          heightCm: user.profile?.heightCm,
          weightKg: user.profile?.weightKg,
        },
      };
    });

    let result;
    try {
      result = await loginTransaction();
    } catch (error: any) {
      // A concurrent first login can win the telegramId unique constraint.
      // Retry outside the failed transaction so Prisma can start a new one.
      const target = error?.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(',') : String(target || '');
      if (error?.code === 'P2002' && /telegram/i.test(targetStr)) {
        result = await loginTransaction();
      } else {
        throw error;
      }
    }

    return result;
  }

  private async createSession(prisma: Prisma.TransactionClient, userId: string) {
    const rawToken = `rt_${randomBytes(32).toString('hex')}`;
    const hash = await argon2.hash(rawToken, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + Number(this.configService.get<number>('REFRESH_TOKEN_TTL_DAYS') || 30) * 24 * 60 * 60 * 1000);

    const session = await prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: hash,
        expiresAt,
      },
    });

    return { ...session, refreshToken: rawToken };
  }

  private signAccessToken(userId: string, sessionId: string, roles: string[]) {
    return this.jwtService.sign({ sub: userId, sessionId, roles });
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'refreshToken is required' });
    }

    const sessions = await this.prisma.authSession.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });

    let session = null;
    for (const candidate of sessions) {
      const valid = await argon2.verify(candidate.refreshTokenHash, refreshToken).catch(() => false);
      if (valid) {
        session = candidate;
        break;
      }
    }

    if (!session) {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token is invalid' });
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      await this.revokeSession(session.id, 'ACCOUNT_DELETED');
      throw new ForbiddenException({ code: 'ACCOUNT_DELETED', message: 'Account deleted or blocked' });
    }

    const result = await this.prisma.$transaction(async (prisma: Prisma.TransactionClient) => {
      const revoked = await prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token is invalid' });
      }

      const newSession = await this.createSession(prisma, session.userId);
      await prisma.auditLog.create({
        data: {
          actorUserId: session.userId,
          targetUserId: session.userId,
          action: 'AUTH_REFRESH_SUCCESS',
          entityType: 'AuthSession',
          entityId: newSession.id,
          metadata: { rotatedFrom: session.id },
        },
      });
      return {
        accessToken: this.signAccessToken(session.userId, newSession.id, session.user.roles.map(r => r.role.code)),
        refreshToken: newSession.refreshToken,
        expiresIn: Number(this.configService.get<number>('JWT_ACCESS_TTL_SECONDS') || 900),
      };
    });

    return result;
  }

  async logout(sessionId: string, userId: string) {
    const session = await this.prisma.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt) {
      return;
    }

    await this.revokeSession(sessionId, 'LOGOUT');
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        targetUserId: userId,
        action: 'AUTH_LOGOUT',
        entityType: 'AuthSession',
        entityId: sessionId,
      },
    });
  }

  private async revokeSession(sessionId: string, reason: string) {
    await this.prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokedReason: reason } });
  }
}
