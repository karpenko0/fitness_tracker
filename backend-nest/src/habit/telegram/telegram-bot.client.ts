import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TelegramSendResult =
  | { ok: true; messageId?: number }
  | { ok: false; kind: 'retry'; retryAfterSeconds?: number; message: string }
  | { ok: false; kind: 'blocked'; message: string }
  | { ok: false; kind: 'fatal'; message: string };

/**
 * Минимальный клиент Telegram Bot API (SPEC-009).
 * - 200 -> ok
 * - 429 -> retry (retry_after из parameters)
 * - 5xx / сетевая ошибка -> retry (временная ошибка)
 * - 403 -> blocked (пользователь заблокировал бота)
 * - прочие 4xx -> fatal
 * Токен никогда не попадает в возвращаемые сообщения/логи (sanitizeError).
 */
@Injectable()
export class TelegramBotClient {
  private readonly logger = new Logger(TelegramBotClient.name);
  private readonly token: string | undefined;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
    this.baseUrl = config.get<string>('TELEGRAM_BOT_API_URL') || 'https://api.telegram.org';
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramSendResult> {
    if (!this.token) {
      return { ok: false, kind: 'fatal', message: 'TELEGRAM_BOT_TOKEN is not configured' };
    }
    try {
      const response = await fetch(`${this.baseUrl}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      const body: any = await response.json().catch(() => ({}));
      if (response.ok && body?.ok) {
        return { ok: true, messageId: body.result?.message_id };
      }
      const description = this.sanitizeError(String(body?.description ?? `HTTP ${response.status}`));
      if (response.status === 429) {
        const retryAfter = Number(body?.parameters?.retry_after) || undefined;
        return { ok: false, kind: 'retry', retryAfterSeconds: retryAfter, message: description };
      }
      if (response.status === 403) {
        return { ok: false, kind: 'blocked', message: description };
      }
      if (response.status >= 500) {
        return { ok: false, kind: 'retry', message: description };
      }
      return { ok: false, kind: 'fatal', message: description };
    } catch (error) {
      // Сетевая ошибка — временная
      return { ok: false, kind: 'retry', message: this.sanitizeError((error as Error)?.message ?? 'network error') };
    }
  }

  /** Удаляет токен бота из текста ошибки, чтобы он не попал в lastError/логи. */
  sanitizeError(message: string): string {
    if (this.token && message.includes(this.token)) {
      return message.split(this.token).join('[REDACTED]');
    }
    return message;
  }
}
