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
});
