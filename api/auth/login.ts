import { authenticateExternalLogin } from '../../src/auth-login';

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

export default function handler(req: LoginRequest, res: LoginResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method-not-allowed' });
    return;
  }

  const loginResult = authenticateExternalLogin(parseBody(req.body), process.env);

  if (!loginResult) {
    res.status(401).json({ code: 'invalid-credentials' });
    return;
  }

  res.status(200).json(loginResult);
}
