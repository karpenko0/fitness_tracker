import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Prisma } from '@prisma/client';
import { ProgressionMetricsService } from './progression-metrics.service';

@Injectable()
export class ProgressionAuditService {
  async recordRecalculation(tx: Prisma.TransactionClient, actorUserId: string, workoutId: string, reason: string, algorithmVersion: string) {
    return tx.auditLog.create({ data: { actorUserId, action: 'PROGRESSION_RECALCULATION_REQUESTED', entityType: 'WORKOUT', entityId: workoutId, metadata: { reason, algorithmVersion } } });
  }
}

@Injectable()
export class ProgressionApiMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: ProgressionMetricsService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const started = Date.now();
    const endpoint = request.route?.path || request.url;
    return next.handle().pipe(tap({
      next: () => this.observe(endpoint, context.switchToHttp().getResponse().statusCode, started),
      error: (error) => this.observe(endpoint, error?.status || 500, started),
    }));
  }
  private observe(endpoint: string, statusCode: number, started: number) {
    if (!String(endpoint).includes('progression')) return;
    this.metrics.observe('progression_api_duration_ms', Date.now() - started, { endpoint, status_code: statusCode });
  }
}
