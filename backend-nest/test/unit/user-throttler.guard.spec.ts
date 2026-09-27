import { createHmac } from 'crypto';
import { verifiedSub } from '../../src/common/guards/user-throttler.guard';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload: object, secret: string, alg = 'HS256') => {
  const h = b64({ alg, typ: 'JWT' }); const p = b64(payload);
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};

describe('verifiedSub (throttler tracker)', () => {
  const secret = 's'.repeat(32);
  it('returns sub for a valid HS256 token', () => {
    expect(verifiedSub(`Bearer ${sign({ sub: 'u1', exp: Date.now() / 1000 + 60 }, secret)}`, secret)).toBe('u1');
  });
  it('rejects forged signature, expired token, alg none and garbage', () => {
    expect(verifiedSub(`Bearer ${sign({ sub: 'u1' }, 'other-secret')}`, secret)).toBeNull();
    expect(verifiedSub(`Bearer ${sign({ sub: 'u1', exp: 1 }, secret)}`, secret)).toBeNull();
    expect(verifiedSub(`Bearer ${sign({ sub: 'u1' }, secret, 'none')}`, secret)).toBeNull();
    expect(verifiedSub('Bearer abc', secret)).toBeNull();
    expect(verifiedSub(undefined, secret)).toBeNull();
  });
});
