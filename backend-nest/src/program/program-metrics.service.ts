import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ProgramMetricsService {
  private readonly logger = new Logger('programs');
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, number[]>();
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  event(event: string, fields: Record<string, unknown> = {}) {
    this.logger.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', service: 'api', module: 'programs', event, ...fields }));
  }

  increment(name: string, labels: Record<string, string | number> = {}) {
    const key = `${name}:${JSON.stringify(labels)}`;
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  observe(name: string, value: number, labels: Record<string, string | number> = {}) {
    const key = `${name}:${JSON.stringify(labels)}`;
    const values = this.durations.get(key) || [];
    values.push(value);
    this.durations.set(key, values.slice(-1_000));
  }

  getCached<T>(key: string): T | null {
    const hit = this.cache.get(key);
    if (!hit || hit.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    this.increment('program_cache_hit_total', { resource_type: key.split(':')[0] });
    return hit.value as T;
  }

  setCached(key: string, value: unknown, ttlMs = 60_000) {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(prefix: string) {
    for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  snapshot() {
    return { counters: Object.fromEntries(this.counters), histograms: Object.fromEntries([...this.durations].map(([key, values]) => [key, { count: values.length, p95: values.length ? values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : 0 }])) };
  }
}
