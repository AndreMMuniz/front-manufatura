// @vitest-environment node

import { decodeProtectedHeader, decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { createAppSessionToken, verifyAppSessionToken } from './app-session-token';

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-08-07T12:00:00.000Z');

describe('app session token', () => {
  it('emite e verifica JWT HS256 com claims fechadas e expiração compartilhada', async () => {
    const issued = await createAppSessionToken({
      subject: 'operador', secret: SECRET, ttlMs: 60_000, now: NOW,
    });

    expect(decodeProtectedHeader(issued.token)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decodeJwt(issued.token)).toMatchObject({
      iss: 'plano-de-controle',
      aud: 'plano-de-controle-api',
      sub: 'operador',
      iat: 1786104000,
      exp: 1786104060,
    });
    expect(issued.tokenExpiresAt).toBe('2026-08-07T12:01:00.000Z');
    expect(JSON.stringify({ header: decodeProtectedHeader(issued.token), payload: decodeJwt(issued.token) }))
      .not.toMatch(/senha|basic|authorization|datasul/i);
    await expect(verifyAppSessionToken(issued.token, SECRET, NOW)).resolves.toMatchObject({
      sub: 'operador', exp: 1786104060,
    });
  });

  it('rejeita assinatura adulterada, expiração e claims/algoritmo inesperados', async () => {
    const issued = await createAppSessionToken({
      subject: 'operador', secret: SECRET, ttlMs: 1000, now: NOW,
    });
    const altered = `${issued.token.slice(0, -1)}${issued.token.endsWith('a') ? 'b' : 'a'}`;
    const wrongClaims = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('outro')
      .setAudience('plano-de-controle-api')
      .setSubject('operador')
      .setIssuedAt(1786104000)
      .setExpirationTime(1786104060)
      .sign(new TextEncoder().encode(SECRET));
    const wrongAlgorithm = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS384' })
      .setIssuer('plano-de-controle')
      .setAudience('plano-de-controle-api')
      .setSubject('operador')
      .setIssuedAt(1786104000)
      .setExpirationTime(1786104060)
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyAppSessionToken(altered, SECRET, NOW)).rejects.toThrow();
    await expect(verifyAppSessionToken(issued.token, SECRET, new Date(NOW.getTime() + 2000))).rejects.toThrow();
    await expect(verifyAppSessionToken(wrongClaims, SECRET, NOW)).rejects.toThrow();
    await expect(verifyAppSessionToken(wrongAlgorithm, SECRET, NOW)).rejects.toThrow();
  });
});
