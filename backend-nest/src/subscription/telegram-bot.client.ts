import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Telegram поддерживает подписки Stars только с периодом 30 дней. */
export const TELEGRAM_SUBSCRIPTION_PERIOD_SECONDS = 2_592_000;

export class TelegramApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface CreateInvoiceInput {
  title: string;
  description: string;
  payload: string;
  amountStars: number;
  subscriptionPeriodSeconds?: number;
}

export abstract class TelegramBotClient {
  abstract createInvoiceLink(input: CreateInvoiceInput): Promise<string>;
  abstract answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void>;
  abstract refundStarPayment(userTelegramId: string, telegramPaymentChargeId: string): Promise<void>;
  abstract editUserStarSubscription(userTelegramId: string, telegramPaymentChargeId: string, isCanceled: boolean): Promise<void>;
}

/**
 * HTTP-адаптер Bot API. Стоп-линия SPEC-010 §13: реальные вызовы выполняются только при
 * TELEGRAM_PAYMENTS_ENABLED=true; иначе адаптер отказывает, не обращаясь к Telegram.
 * Токен никогда не попадает в сообщения ошибок.
 */
@Injectable()
export class HttpTelegramBotClient extends TelegramBotClient {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async createInvoiceLink(input: CreateInvoiceInput): Promise<string> {
    const result = await this.call<string>('createInvoiceLink', {
      title: input.title.slice(0, 32),
      description: input.description.slice(0, 255),
      payload: input.payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: input.title.slice(0, 32), amount: input.amountStars }],
      ...(input.subscriptionPeriodSeconds ? { subscription_period: input.subscriptionPeriodSeconds } : {}),
    });
    return result;
  }

  async answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string) {
    await this.call('answerPreCheckoutQuery', { pre_checkout_query_id: id, ok, ...(ok ? {} : { error_message: errorMessage ?? 'Payment cannot be completed' }) }, 5_000);
  }

  async refundStarPayment(userTelegramId: string, chargeId: string) {
    await this.call('refundStarPayment', { user_id: Number(userTelegramId), telegram_payment_charge_id: chargeId });
  }

  async editUserStarSubscription(userTelegramId: string, chargeId: string, isCanceled: boolean) {
    await this.call('editUserStarSubscription', { user_id: Number(userTelegramId), telegram_payment_charge_id: chargeId, is_canceled: isCanceled });
  }

  private async call<T = unknown>(method: string, body: object, timeoutMs = 8_000): Promise<T> {
    if (this.config.get('TELEGRAM_PAYMENTS_ENABLED') !== 'true') throw new TelegramApiError('PAYMENTS_DISABLED', 'Telegram payments are disabled in this environment');
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new TelegramApiError('BOT_NOT_CONFIGURED', 'Telegram bot is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new TelegramApiError(`TELEGRAM_${res.status}`, `Telegram ${method} failed`);
      return json.result as T;
    } catch (e) {
      if (e instanceof TelegramApiError) throw e;
      throw new TelegramApiError('TELEGRAM_UNAVAILABLE', `Telegram ${method} unavailable`);
    } finally {
      clearTimeout(timer);
    }
  }
}
