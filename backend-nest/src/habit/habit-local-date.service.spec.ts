import { HabitLocalDateService } from './habit-local-date.service';

describe('HabitLocalDateService', () => {
  const service = new HabitLocalDateService();

  it('returns local date string in the given timezone', () => {
    // 25.09.2026 23:30 UTC в Москве уже 26 сентября
    expect(service.localDateString('Europe/Moscow', new Date('2026-09-25T23:30:00Z'))).toBe('2026-09-26');
    expect(service.localDateString('UTC', new Date('2026-09-25T23:30:00Z'))).toBe('2026-09-25');
    // Кирибати (UTC+14): там уже 26-е
    expect(service.localDateString('Pacific/Kiritimati', new Date('2026-09-25T12:00:00Z'))).toBe('2026-09-26');
    // Гонолулу (UTC-10): ещё 25-е
    expect(service.localDateString('Pacific/Honolulu', new Date('2026-09-26T05:00:00Z'))).toBe('2026-09-25');
  });

  it('returns local date as UTC-midnight Date (safe for DATE columns)', () => {
    const date = service.localDateIn('Europe/Moscow', new Date('2026-09-25T23:30:00Z'));
    expect(date.toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });

  it('maps weekday to 1..7 where Monday = 1', () => {
    // 2026-09-21 — понедельник, 2026-09-27 — воскресенье
    expect(service.weekdayIn('UTC', new Date('2026-09-21T12:00:00Z'))).toBe(1);
    expect(service.weekdayIn('UTC', new Date('2026-09-25T12:00:00Z'))).toBe(5); // пятница
    expect(service.weekdayIn('UTC', new Date('2026-09-27T12:00:00Z'))).toBe(7);
  });

  it('computes weekday from the local date, not UTC instant', () => {
    // Пятница 23:30 UTC = суббота в Москве
    expect(service.weekdayIn('Europe/Moscow', new Date('2026-09-25T23:30:00Z'))).toBe(6);
  });
});
