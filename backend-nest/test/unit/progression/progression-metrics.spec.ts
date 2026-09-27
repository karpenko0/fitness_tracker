import { ProgressionMetricsService } from '../../../src/progression/progression-metrics.service';

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
