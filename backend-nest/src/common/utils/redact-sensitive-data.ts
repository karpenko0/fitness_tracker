const SENSITIVE_KEYS = new Set(['authorization', 'initdata', 'refreshtoken', 'accesstoken', 'telegram_bot_token']);

export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveData);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
    key,
    SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactSensitiveData(nestedValue),
  ]));
}
