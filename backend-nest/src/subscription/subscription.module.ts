import { Module } from '@nestjs/common';
import { EntitlementsGuard } from './entitlements.guard';
import { EntitlementsService } from './entitlements.service';
import { PaymentProcessor } from './payment-processor.service';
import { RefundService } from './refund.service';
import { AdminPaymentsController, SubscriptionController, TelegramWebhookController } from './subscription.controller';
import { SubscriptionLogger, SubscriptionMetrics } from './subscription.observability';
import { SubscriptionScheduler } from './subscription.scheduler';
import { SubscriptionService } from './subscription.service';
import { FinancialIdempotency } from './subscription.support';
import { HttpTelegramBotClient, TelegramBotClient } from './telegram-bot.client';
import { TelegramWebhookService } from './telegram-webhook.service';

@Module({
  controllers: [SubscriptionController, AdminPaymentsController, TelegramWebhookController],
  providers: [
    SubscriptionMetrics,
    SubscriptionLogger,
    FinancialIdempotency,
    EntitlementsService,
    EntitlementsGuard,
    PaymentProcessor,
    SubscriptionService,
    RefundService,
    TelegramWebhookService,
    SubscriptionScheduler,
    { provide: TelegramBotClient, useClass: HttpTelegramBotClient },
  ],
  exports: [EntitlementsService, EntitlementsGuard],
})
export class SubscriptionModule {}
