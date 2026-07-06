import { randomUUID } from 'node:crypto';

interface LoginRequest {
  method?: string;
  body?: unknown;
}

interface LoginResponse {
  setHeader(name: string, value: string): void;
  status(code: number): LoginResponse;
  json(body: unknown): void;
}

function parseBody(body: unknown) {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return {};
  }
}

function authenticateExternalLogin(input: unknown) {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const login = typeof body['login'] === 'string' ? body['login'].trim() : '';
  const senha = typeof body['senha'] === 'string' ? body['senha'].trim() : '';
  const user = process.env['APP_LOGIN_USER']?.trim() || 'operador';
  const password = process.env['APP_LOGIN_PASSWORD']?.trim() || 'mock123';
  const name = process.env['APP_LOGIN_NAME']?.trim() || 'Operador Cortag';

  if (!login || !senha || login !== user || senha !== password) {
    return null;
  }

  return {
    token: `external-session-${randomUUID()}`,
    usuario: {
      id: 'USR-EXTERNAL',
      nome: name,
      login,
      permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
    },
  };
}

export default function handler(req: LoginRequest, res: LoginResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ code: 'method-not-allowed' });
      return;
    }

    const loginResult = authenticateExternalLogin(parseBody(req.body));

    if (!loginResult) {
      res.status(401).json({ code: 'invalid-credentials' });
      return;
    }

    res.status(200).json(loginResult);
  } catch (error) {
    console.error('Login function failed', error);
    res.status(500).json({ code: 'login-function-failed' });
  }
}
