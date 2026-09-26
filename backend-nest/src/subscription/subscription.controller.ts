import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { PAYMENT_STATUSES, REFUND_REASONS } from './subscription.catalog';
import { SubscriptionService } from './subscription.service';
import { RefundService } from './refund.service';
import { SubscriptionMetrics } from './subscription.observability';
import { TelegramWebhookService } from './telegram-webhook.service';
import { SubscriptionError } from './subscription.domain';

export class CreateInvoiceDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  planCode!: string;
}

export class PaymentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RefundDto {
  @IsIn(REFUND_REASONS as unknown as string[])
  reason!: string;
}

export class AdminPaymentsQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

const rid = (h?: string) => (h && /^[A-Za-z0-9_\-]{1,128}$/.test(h) ? h : `req_${randomUUID()}`);

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('subscriptions/plans')
  plans(@GetCurrentUser() user: UserRequest, @Headers('x-request-id') requestId?: string) {
    return this.subscriptions.listPlans({ userId: user.userId, requestId: rid(requestId) });
  }

  @Get('subscriptions/me')
  me(@GetCurrentUser() user: UserRequest, @Headers('x-request-id') requestId?: string) {
    return this.subscriptions.getMe({ userId: user.userId, requestId: rid(requestId) });
  }

  @Post('subscriptions/invoices')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createInvoice(@GetCurrentUser() user: UserRequest, @Body() body: CreateInvoiceDto, @Headers('idempotency-key') key?: string, @Headers('x-request-id') requestId?: string) {
    return this.subscriptions.createInvoice({ userId: user.userId, requestId: rid(requestId) }, body, key);
  }

  @Post('subscriptions/me/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  cancel(@GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string, @Headers('x-request-id') requestId?: string) {
    return this.subscriptions.cancelAutoRenew({ userId: user.userId, requestId: rid(requestId) }, key);
  }

  @Get('payments')
  payments(@GetCurrentUser() user: UserRequest, @Query() query: PaymentsQueryDto) {
    return this.subscriptions.listPayments(user.userId, query);
  }
}

@ApiTags('admin-payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/admin')
export class AdminPaymentsController {
  constructor(private readonly refunds: RefundService, private readonly metrics: SubscriptionMetrics) {}

  @Get('payments')
  list(@GetCurrentUser() user: UserRequest, @Query() query: AdminPaymentsQueryDto, @Headers('x-request-id') requestId?: string) {
    return this.refunds.listForAdmin({ userId: user.userId, roles: user.roles, requestId: rid(requestId) }, query);
  }

  @Post('payments/:paymentId/refund')
  @HttpCode(202)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  refund(@GetCurrentUser() user: UserRequest, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() body: RefundDto, @Headers('idempotency-key') key?: string, @Headers('x-request-id') requestId?: string) {
    return this.refunds.requestRefund({ userId: user.userId, roles: user.roles, requestId: rid(requestId) }, paymentId, body.reason, key);
  }

  @Get('subscriptions/metrics')
  metricsText(@GetCurrentUser() user: UserRequest) {
    if (!user.roles.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'SYSTEM')) throw new SubscriptionError(403, 'FORBIDDEN', 'Administrative role is required');
    return { metrics: this.metrics.render() };
  }
}

/** Внутренний webhook Telegram: без JWT, скрыт из Swagger, ответ без причин отказа. */
@ApiExcludeController()
@Controller('api/v1/webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly webhooks: TelegramWebhookService) {}

  @Post(':webhookSecret')
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  async receive(@Param('webhookSecret') secret: string, @Req() req: Request, @Res() res: Response, @Headers('x-telegram-bot-api-secret-token') headerSecret?: string) {
    const size = Number(req.headers['content-length'] ?? JSON.stringify(req.body ?? {}).length);
    const result = await this.webhooks.handle(secret, headerSecret, req.body, size, rid(req.headers['x-request-id'] as string));
    res.status(result.httpStatus).end();
  }
}
