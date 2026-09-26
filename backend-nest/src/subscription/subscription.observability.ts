import { Injectable, Logger } from '@nestjs/common';
import { redactFinancial } from './subscription.domain';

type Labels = Record<string, string | number | undefined>;

/** Метрики §10.2 (in-memory, Prometheus text format через GET /api/v1/admin/subscriptions/metrics). */
@Injectable()
export class SubscriptionMetrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();

  inc(name: string, labels: Labels = {}, by = 1) {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  set(name: string, labels: Labels, value: number) {
    this.gauges.set(this.key(name, labels), value);
  }

  observe(name: string, labels: Labels, seconds: number) {
    const key = this.key(name, labels);
    const list = this.histograms.get(key) ?? [];
    list.push(seconds);
    if (list.length > 1000) list.shift();
    this.histograms.set(key, list);
  }

  get(name: string, labels: Labels = {}) {
    return this.counters.get(this.key(name, labels)) ?? this.gauges.get(this.key(name, labels)) ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.gauges) lines.push(`${k} ${v}`);
    for (const [k, list] of this.histograms) {
      const sorted = [...list].sort((a, b) => a - b);
      const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
      lines.push(`${k.replace('{', '_p95{')} ${p95}`, `${k.replace('{', '_count{')} ${list.length}`);
    }
    return lines.join('\n');
  }

  private key(name: string, labels: Labels) {
    const parts = Object.entries(labels).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${String(v)}"`);
    return `${name}{${parts.join(',')}}`;
  }
}

export interface LogFields {
  requestId?: string;
  userId?: string;
  paymentId?: string;
  subscriptionId?: string;
  webhookUpdateId?: number | string;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

/** Структурированные JSON-логи §10.1 с обязательной redaction. */
@Injectable()
export class SubscriptionLogger {
  private readonly logger = new Logger('subscriptions');
  readonly records: string[] = [];
  captureForTests = false;

  log(event: string, fields: LogFields = {}, level: 'info' | 'warn' | 'error' = 'info') {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: 'fittrack-api',
      module: 'subscriptions',
      event,
      ...(redactFinancial(fields) as object),
    });
    if (this.captureForTests) { this.records.push(line); return; }
    if (level === 'error') this.logger.error(line);
    else if (level === 'warn') this.logger.warn(line);
    else this.logger.log(line);
  }
}
