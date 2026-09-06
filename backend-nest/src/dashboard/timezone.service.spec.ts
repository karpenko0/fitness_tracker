import { DashboardTimezoneService } from './timezone.service';

describe('DashboardTimezoneService', () => {
  const service = new DashboardTimezoneService();
  it('falls back from invalid header to profile and UTC', () => {
    expect(service.resolve('Not/AZone', 'Europe/Moscow').timezone).toBe('Europe/Moscow');
    expect(service.resolve('Not/AZone', undefined).timezone).toBe('UTC');
  });
  it('handles DST boundary with timezone-aware local dates', () => {
    expect(service.localDate(new Date('2026-03-29T00:30:00Z'), 'Europe/Berlin')).toBe('2026-03-29');
    expect(service.localDate(new Date('2026-03-29T22:30:00Z'), 'Europe/Berlin')).toBe('2026-03-30');
    const boundaries = service.boundaries(new Date('2026-03-29T12:00:00Z'), 'Europe/Berlin');
    expect(boundaries.end.getTime() - boundaries.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
