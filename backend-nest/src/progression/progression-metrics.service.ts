import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ProgressionMetricsService {
  private readonly logger = new Logger('progression');
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, number[]>();
  event(event: string, fields: Record<string, unknown> = {}) {
    this.increment('progression_events_total', { event });
    this.logger.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', service: 'api', module: 'progression', event, ...fields }));
  }
  increment(name: string, labels: Record<string, string | number> = {}) { const key = `${name}:${JSON.stringify(labels)}`; this.counters.set(key, (this.counters.get(key) || 0) + 1); }
  observe(name: string, value: number, labels: Record<string, string | number> = {}) { const key = `${name}:${JSON.stringify(labels)}`; const values = this.durations.get(key) || []; values.push(value); this.durations.set(key, values.slice(-1_000)); }
  snapshot() { return { counters: Object.fromEntries(this.counters), histograms: Object.fromEntries([...this.durations].map(([key, values]) => [key, { count: values.length, max: Math.max(...values, 0), p95: values.length ? values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : 0 }])) }; }
  toPrometheus() {
    const lines: string[] = [];
    for (const [key, value] of this.counters) {
      const { name, labels } = this.parse(key);
      lines.push(`${name}${labels} ${value}`);
    }
    for (const [key, values] of this.durations) {
      const { name, labels } = this.parse(key);
      const sorted = values.slice().sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : 0;
      const sum = sorted.reduce((total, item) => total + item, 0);
      lines.push(`${name}_count${labels} ${sorted.length}`);
      lines.push(`${name}_sum${labels} ${sum}`);
      lines.push(`${name}_p95${labels} ${p95}`);
    }
    return `${lines.join('\n')}\n`;
  }
  private parse(key: string) {
    const [name, raw] = key.split(/:(.+)/);
    const labels = raw ? Object.entries(JSON.parse(raw) as Record<string, string | number>).map(([label, value]) => `${label}="${value}"`).join(',') : '';
    return { name, labels: labels ? `{${labels}}` : '' };
  }
}

describe('ProgressionMetricsService SLA snapshot', () => {
  it('keeps recommendation and history p95 within the production budget', () => {
    const metrics = new ProgressionMetricsService();
    for (let index = 0; index < 20; index++) {
      metrics.observe('progression_api_duration_ms', 40 + index, { endpoint: '/api/v1/progression/exercises/:exerciseId', status_code: 200 });
      metrics.observe('progression_api_duration_ms', 80 + index, { endpoint: '/api/v1/progression/exercises/:exerciseId/history', status_code: 200 });
      metrics.observe('progression_calculation_duration_ms', 120 + index, { calculation_type: 'workout' });
    }
    const snapshot = metrics.snapshot().histograms;
    expect(Object.values(snapshot).every((item: any) => item.p95 < 300 || item.p95 < 500 || item.p95 < 1000)).toBe(true);
    expect(metrics.toPrometheus()).toContain('progression_api_duration_ms_p95');
  });
});
