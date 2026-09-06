import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DashboardMetricsService {
  private readonly logger = new Logger('dashboard.metrics');
  event(name: string, fields: Record<string, unknown> = {}) { this.logger.log(JSON.stringify({ module: 'dashboard', event: name, ...fields })); }
}
