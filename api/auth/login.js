function parseBody(body) {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function createSessionToken() {
  return `external-session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function authenticateExternalLogin(input) {
  const body = input && typeof input === 'object' ? input : {};
  const login = typeof body.login === 'string' ? body.login.trim() : '';
  const senha = typeof body.senha === 'string' ? body.senha.trim() : '';
  const user = process.env.APP_LOGIN_USER?.trim() || 'operador';
  const password = process.env.APP_LOGIN_PASSWORD?.trim() || 'mock123';
  const name = process.env.APP_LOGIN_NAME?.trim() || 'Operador Cortag';

  if (!login || !senha || login !== user || senha !== password) {
    return null;
  }

  return {
    token: createSessionToken(),
    usuario: {
      id: 'USR-EXTERNAL',
      nome: name,
      login,
      permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
    },
  };
}

module.exports = function handler(req, res) {
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
};
