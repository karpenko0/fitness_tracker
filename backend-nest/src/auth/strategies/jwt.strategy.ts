import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, UserStatus } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: any) {
    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid token payload' });
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { status: true } },
      },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Access token is revoked or expired' });
    }

    return {
      userId: payload.sub,
      roles: payload.roles || [],
      sessionId: payload.sessionId,
    };
  }
}
