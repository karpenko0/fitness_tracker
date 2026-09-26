import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Entitlement } from './subscription.catalog';
import { EntitlementsService } from './entitlements.service';

export const REQUIRED_ENTITLEMENT = 'subscription:required-entitlement';

/** Использование: @UseGuards(JwtAuthGuard, EntitlementsGuard) @RequireEntitlement('ADVANCED_PROGRESS') */
export const RequireEntitlement = (entitlement: Entitlement) => SetMetadata(REQUIRED_ENTITLEMENT, entitlement);

@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly entitlements: EntitlementsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Entitlement | undefined>(REQUIRED_ENTITLEMENT, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const req = context.switchToHttp().getRequest();
    await this.entitlements.assert(req.user.userId, required, req.headers?.['x-request-id']);
    return true;
  }
}
