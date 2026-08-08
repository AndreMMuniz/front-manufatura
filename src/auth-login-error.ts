export type AuthLoginErrorCode =
  | 'invalid-credentials'
  | 'access-denied'
  | 'datasul-unavailable'
  | 'invalid-upstream-response'
  | 'auth-gateway-not-configured'
  | 'datasul-timeout';

export class AuthLoginError extends Error {
  constructor(
    readonly status: 401 | 403 | 502 | 503 | 504,
    readonly code: AuthLoginErrorCode,
  ) {
    super(code);
    this.name = 'AuthLoginError';
  }

  toJSON(): { status: number; code: AuthLoginErrorCode } {
    return { status: this.status, code: this.code };
  }
}
