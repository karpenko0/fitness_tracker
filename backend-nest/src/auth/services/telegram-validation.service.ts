import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, createHash } from 'crypto';

export interface TelegramInitData {
  auth_date: string;
  hash: string;
  query_id?: string;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    photo_url?: string;
  };
  [key: string]: any;
}

@Injectable()
export class TelegramValidationService {
  validateInitData(initData: string, botToken: string, maxAgeSeconds: number): TelegramInitData {
    if (!initData) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'initData is required' });
    }

    const data = this.parseInitData(initData);
    const { hash, auth_date, user } = data as TelegramInitData;

    if (!hash || !auth_date || !user) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'initData must contain hash, auth_date and user' });
    }

    const authDate = Number(auth_date);
    if (Number.isNaN(authDate)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'auth_date must be a valid timestamp' });
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > maxAgeSeconds) {
      throw new UnauthorizedException({ code: 'TELEGRAM_INIT_DATA_EXPIRED', message: 'Telegram initData is expired' });
    }

    if (!this.verifySignature(initData, botToken)) {
      throw new UnauthorizedException({ code: 'TELEGRAM_INIT_DATA_INVALID', message: 'Telegram initData signature is invalid' });
    }

    return data as TelegramInitData;
  }

  private parseInitData(initData: string): Record<string, any> {
    const values = new URLSearchParams(initData);
    const result: Record<string, any> = {};

    for (const [key, value] of values.entries()) {
      if (key === 'user') {
        try {
          result[key] = JSON.parse(value);
        } catch {
          throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'user must be a valid JSON object' });
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private verifySignature(initData: string, botToken: string): boolean {
    const values = new URLSearchParams(initData);
    const hash = values.get('hash');
    if (!hash) return false;

    const dataCheckString = [...values.entries()]
      .filter(([key]) => key !== 'hash')
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');

    const secretKey = createHash('sha256').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return computedHash === hash;
  }
}
