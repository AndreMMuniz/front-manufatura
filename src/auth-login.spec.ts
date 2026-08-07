import { describe, expect, it, vi } from 'vitest';

import { authenticateExternalLogin } from './auth-login';

const CREDENTIALS = {
  APP_LOGIN_USER: 'operador',
  APP_LOGIN_PASSWORD: 'mock123',
};

describe('authenticateExternalLogin', () => {
  it('emite expiração quando o TTL configurado cabe no intervalo de Date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00.000Z'));

    const result = authenticateExternalLogin(
      { login: 'operador', senha: 'mock123' },
      { ...CREDENTIALS, APP_OFFLINE_SESSION_TTL_MS: '60000' },
    );

    expect(result?.offlineSessionExpiresAt).toBe('2026-07-29T12:01:00.000Z');
    vi.useRealTimers();
  });

  it('mantém o login online sem continuidade quando o TTL excede Date', () => {
    const result = authenticateExternalLogin(
      { login: 'operador', senha: 'mock123' },
      { ...CREDENTIALS, APP_OFFLINE_SESSION_TTL_MS: String(Number.MAX_VALUE) },
    );

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('offlineSessionExpiresAt');
  });
});
