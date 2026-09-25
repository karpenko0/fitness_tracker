import { Body, Controller, ForbiddenException, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HabitCallbackService, TelegramCallbackUpdate } from './habit-callback.service';

/**
 * Webhook для callback-кнопок Telegram-бота (SPEC-009).
 * JWT не используется: подлинность подтверждается секретом вебхука
 * (X-Telegram-Bot-Api-Secret-Token, если TELEGRAM_WEBHOOK_SECRET задан)
 * и сверкой Telegram-пользователя с владельцем привычки в сервисе.
 */
@ApiTags('telegram')
@Controller('api/v1/telegram/habits')
export class HabitCallbackController {
  constructor(
    private readonly callbacks: HabitCallbackService,
    private readonly config: ConfigService,
  ) {}

  @Post('callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telegram callback «Отметить выполненной»' })
  async handleCallback(
    @Body() update: TelegramCallbackUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    const expected = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (expected && secret !== expected) {
      throw new ForbiddenException({ code: 'WEBHOOK_SECRET_INVALID', message: 'Invalid webhook secret' });
    }
    return this.callbacks.handleCallback(update);
  }
}
