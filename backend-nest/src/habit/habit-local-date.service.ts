import { Injectable } from '@nestjs/common';

/**
 * Локальные даты/дни недели в IANA-timezone пользователя (SPEC-009: задания и streak
 * считаются по локальной дате привычки, а не по UTC).
 *
 * Локальная дата представляется как Date на UTC-полночь соответствующего дня —
 * это безопасно для хранения в колонке типа DATE и для сравнений «день начался/закончился».
 */
@Injectable()
export class HabitLocalDateService {
  /** 'YYYY-MM-DD' локальной даты в указанной timezone. */
  localDateString(timezone: string, when: Date = new Date()): string {
    // en-CA даёт формат YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(when);
  }

  /** Локальная дата как Date на UTC-полночь (для хранения в DATE и сравнений). */
  localDateIn(timezone: string, when: Date = new Date()): Date {
    const [year, month, day] = this.localDateString(timezone, when).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  /** День недели локальной даты: 1 = понедельник ... 7 = воскресенье. */
  weekdayIn(timezone: string, when: Date = new Date()): number {
    const date = this.localDateIn(timezone, when);
    const sundayBased = date.getUTCDay(); // 0 = воскресенье
    return ((sundayBased + 6) % 7) + 1;
  }
}
