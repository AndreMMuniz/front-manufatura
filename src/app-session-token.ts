import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const TOKEN_ISSUER = 'plano-de-controle';
const TOKEN_AUDIENCE = 'plano-de-controle-api';

export interface CreateAppSessionTokenInput {
  subject: string;
  permissions: readonly string[];
  secret: string;
  ttlMs: number;
  now: Date;
}

export interface IssuedAppSessionToken {
  token: string;
  tokenExpiresAt: string;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createAppSessionToken(
  input: CreateAppSessionTokenInput,
): Promise<IssuedAppSessionToken> {
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  const expiresAt = issuedAt + Math.ceil(input.ttlMs / 1000);
  const token = await new SignJWT({ permissions: [...input.permissions] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(input.subject)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secretKey(input.secret));

  return {
    token,
    tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyAppSessionToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<JWTPayload> {
  const result = await jwtVerify(token, secretKey(secret), {
    algorithms: ['HS256'],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    currentDate: now,
    requiredClaims: ['sub', 'iat', 'exp'],
  });

  return result.payload;
}
