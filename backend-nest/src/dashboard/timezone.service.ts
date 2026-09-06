import { BadRequestException, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DashboardTimezoneService {
  private readonly logger = new Logger('dashboard');

  isValid(value: string) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; }
  }

  resolve(header: string | undefined, profile: string | undefined) {
    if (header && this.isValid(header)) return { timezone: header, source: 'header' as const };
    if (header) this.logger.warn(JSON.stringify({ event: 'dashboard.invalid_timezone_header', timezone: header }));
    if (profile && this.isValid(profile)) return { timezone: profile, source: 'profile' as const };
    return { timezone: 'UTC', source: 'default' as const };
  }

  localDate(now: Date, timezone: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }

  parts(date: Date, timezone: string) {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return values as Record<string, string>;
  }

  offset(date: Date, timezone: string) {
    const p = this.parts(date, timezone);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime();
  }

  boundaries(now: Date, timezone: string) {
    const p = this.parts(now, timezone);
    const dayUtc = Date.UTC(+p.year, +p.month - 1, +p.day);
    const noon = new Date(dayUtc + 12 * 60 * 60 * 1000);
    const startCandidate = new Date(dayUtc);
    const start = new Date(dayUtc - this.offset(startCandidate, timezone));
    const nextCandidate = new Date(dayUtc + 86400000);
    const next = new Date(nextCandidate.getTime() - this.offset(nextCandidate, timezone));
    return { localDate: `${p.year}-${p.month}-${p.day}`, start, end: next, weekStart: new Date(start.getTime() - (((new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay() + 6) % 7) * 86400000)) };
  }
}
