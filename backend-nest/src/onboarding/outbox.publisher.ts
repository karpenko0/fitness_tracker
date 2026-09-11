import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DashboardInvalidationService } from '../dashboard/dashboard-invalidation.service';

@Injectable()
export class OnboardingOutboxPublisher implements OnModuleInit {
  private readonly logger = new Logger('onboarding-outbox');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaClient, private readonly dashboardInvalidation: DashboardInvalidationService) {}
  onModuleInit() { this.timer = setInterval(() => void this.publish(), 5_000); }
  async publish() {
    const events = await this.prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: 50 });
    for (const event of events) {
      try {
        if (event.userId && this.invalidatesDashboard(event.type)) {
          await this.dashboardInvalidation.invalidateUser(event.userId, event.type);
        }
        // Replace this log sink with Redis/NATS/Kafka transport in deployment.
        this.logger.log(JSON.stringify({ event: 'outbox.published', eventId: event.id, type: event.type }));
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
      } catch (error) { this.logger.error(`Failed to publish outbox event ${event.id}`, error); }
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private invalidatesDashboard(type: string) {
    return type.startsWith('onboarding.') || type.startsWith('profile.') || type.startsWith('program.') || type.startsWith('workout.') || type.startsWith('notification.');
  }
}
