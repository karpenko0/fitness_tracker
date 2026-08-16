import { Test, TestingModule } from '@nestjs/testing';
import { TelegramValidationService } from '../../src/auth/services/telegram-validation.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

describe('TelegramValidationService', () => {
  let service: TelegramValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TelegramValidationService],
    }).compile();

    service = module.get<TelegramValidationService>(TelegramValidationService);
  });

  it('should validate valid initData', () => {
    const botToken = 'test_token';
    const values = {
      auth_date: `${Math.floor(Date.now() / 1000)}`,
      hash: '',
      user: JSON.stringify({ id: 123, first_name: 'Ivan' }),
    };

    const stringified = Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    const secretKey = require('crypto').createHash('sha256').update(botToken).digest();
    const hash = require('crypto').createHmac('sha256', secretKey).update('auth_date=' + values.auth_date + '\nuser=' + values.user).digest('hex');
    const initData = `auth_date=${values.auth_date}&user=${encodeURIComponent(values.user)}&hash=${hash}`;

    const result = service.validateInitData(initData, botToken, 86400);
    expect(result.user.id).toBe(123);
  });

  it('should throw when initData is missing', () => {
    expect(() => service.validateInitData('', 'token', 86400)).toThrow(BadRequestException);
  });

  it('should throw when auth_date expired', () => {
    const botToken = 'test_token';
    const values = {
      auth_date: `${Math.floor(Date.now() / 1000) - 100000}`,
      user: JSON.stringify({ id: 123, first_name: 'Ivan' }),
    };
    const secretKey = require('crypto').createHash('sha256').update(botToken).digest();
    const hash = require('crypto').createHmac('sha256', secretKey).update('auth_date=' + values.auth_date + '\nuser=' + values.user).digest('hex');
    const initData = `auth_date=${values.auth_date}&user=${encodeURIComponent(values.user)}&hash=${hash}`;

    expect(() => service.validateInitData(initData, botToken, 10)).toThrow(UnauthorizedException);
  });
});
