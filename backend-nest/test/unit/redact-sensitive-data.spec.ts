import { redactSensitiveData } from '../../src/common/utils/redact-sensitive-data';

describe('redactSensitiveData', () => {
  it('removes tokens and Telegram initData recursively', () => {
    expect(redactSensitiveData({
      authorization: 'Bearer access-token',
      initData: 'telegram-init-data',
      nested: { refreshToken: 'refresh-token', safe: 'value' },
    })).toEqual({
      authorization: '[REDACTED]',
      initData: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', safe: 'value' },
    });
  });

  it('redacts medical notes, bot token and webhook secret (SPEC-009)', () => {
    expect(redactSensitiveData({
      TELEGRAM_BOT_TOKEN: 'bot-token',
      telegram_webhook_secret: 'webhook-secret',
      medicalNotes: 'Витамин D3 5000 МЕ',
      nested: { notes: 'принимать после еды', password: 'hunter2', title: 'Пить воду' },
      list: [{ initData: 'x' }, 'plain-string'],
    })).toEqual({
      TELEGRAM_BOT_TOKEN: '[REDACTED]',
      telegram_webhook_secret: '[REDACTED]',
      medicalNotes: '[REDACTED]',
      nested: { notes: '[REDACTED]', password: '[REDACTED]', title: 'Пить воду' },
      list: [{ initData: '[REDACTED]' }, 'plain-string'],
    });
  });

  it('keeps non-sensitive data and primitives untouched', () => {
    expect(redactSensitiveData('just a string')).toBe('just a string');
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData(null)).toBe(null);
    expect(redactSensitiveData({ habitId: 'h1', value: 500 })).toEqual({ habitId: 'h1', value: 500 });
  });
});
