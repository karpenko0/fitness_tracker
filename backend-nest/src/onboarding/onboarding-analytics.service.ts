import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OnboardingAnalyticsService {
  private readonly logger = new Logger('onboarding');
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  event(event: string, fields: Record<string, unknown> = {}) {
    const safe = { ...fields };
    delete safe.limitations;
    delete safe.draftData;
    delete safe.accessToken;
    delete safe.initData;
    this.logger.log(JSON.stringify({ module: 'onboarding', event, ...safe }));
  }
  increment(metric: string, value = 1) { this.counters.set(metric, (this.counters.get(metric) || 0) + value); }
  observe(metric: string, value: number) { this.histograms.set(metric, [...(this.histograms.get(metric) || []), value]); }
  snapshot() { return { counters: Object.fromEntries(this.counters), histograms: Object.fromEntries([...this.histograms].map(([key, values]) => [key, { count: values.length, sum: values.reduce((a, b) => a + b, 0) }])) }; }
}
