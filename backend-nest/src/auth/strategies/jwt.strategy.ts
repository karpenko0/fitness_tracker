import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: any) {
    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid token payload' });
    }
    return {
      userId: payload.sub,
      roles: payload.roles || [],
      sessionId: payload.sessionId,
    };
  }
}
