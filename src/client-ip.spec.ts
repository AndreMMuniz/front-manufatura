// @vitest-environment node
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientIp, forwardedClientIp } from './client-ip';

function request(ip?: string, remoteAddress?: string, chain?: string | string[]): Request {
  return { ip, socket: { remoteAddress }, headers: { 'x-forwarded-for': chain } } as unknown as Request;
}

describe('client origin IP', () => {
  it('prefers Express IP and preserves mapped IPv6', () => {
    const req = request('::ffff:10.101.2.11', '10.101.195.236');
    expect(clientIp(req)).toBe('::ffff:10.101.2.11');
    expect(forwardedClientIp(req)).toBe('::ffff:10.101.2.11');
  });
  it('falls back to the socket then unknown, matching client logs', () => {
    expect(forwardedClientIp(request(undefined, '10.101.2.12'))).toBe('10.101.2.12');
    expect(forwardedClientIp(request())).toBe('unknown');
  });
  it('preserves header values in order, including multiple header entries', () => {
    expect(forwardedClientIp(request('10.101.2.12', undefined, ['10.1.1.1', '::1']))).toBe('10.1.1.1, ::1, 10.101.2.12');
    expect(forwardedClientIp(request('10.101.2.12', undefined, '  '))).toBe('10.101.2.12');
  });
});
