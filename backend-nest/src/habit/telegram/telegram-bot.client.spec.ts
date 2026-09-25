import { TelegramBotClient } from './telegram-bot.client';

describe('TelegramBotClient', () => {
  const TOKEN = 'TEST-TOKEN';
  const config: any = { get: jest.fn((key: string) => (key === 'TELEGRAM_BOT_TOKEN' ? TOKEN : undefined)) };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  const client = () => new TelegramBotClient(config);

  const jsonResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('sends a message and returns ok with message id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 42 } }));
    const result = await client().sendMessage('123', 'Привет');
    expect(result).toEqual({ ok: true, messageId: 42 });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps 429 to retry with retry_after', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 17 } }));
    const result = await client().sendMessage('123', 'x');
    expect(result).toMatchObject({ ok: false, kind: 'retry', retryAfterSeconds: 17 });
  });

  it('maps 5xx to retry (временная ошибка)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(502, { ok: false, description: 'Bad Gateway' }));
    const result = await client().sendMessage('123', 'x');
    expect(result).toMatchObject({ ok: false, kind: 'retry' });
  });

  it('maps network failure to retry', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    const result = await client().sendMessage('123', 'x');
    expect(result).toMatchObject({ ok: false, kind: 'retry', message: 'socket hang up' });
  });

  it('maps 403 to blocked (бот заблокирован)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { ok: false, description: 'Forbidden: bot was blocked by the user' }));
    const result = await client().sendMessage('123', 'x');
    expect(result).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('maps other 4xx to fatal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { ok: false, description: 'Bad Request: chat not found' }));
    const result = await client().sendMessage('123', 'x');
    expect(result).toMatchObject({ ok: false, kind: 'fatal' });
  });

  it('never leaks the bot token in error messages', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { ok: false, description: `Unauthorized https://api.telegram.org/bot${TOKEN}/sendMessage` }));
    const result: any = await client().sendMessage('123', 'x');
    expect(result.message).not.toContain(TOKEN);
    expect(result.message).toContain('[REDACTED]');
  });

  it('returns fatal without a configured token', async () => {
    const noToken: any = { get: jest.fn() };
    const result = await new TelegramBotClient(noToken).sendMessage('123', 'x');
    expect(result).toMatchObject({ ok: false, kind: 'fatal' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
