// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  AuthLoginError,
  authenticateExternalLogin,
  type LoginDependencies,
  type LoginEnvironment,
} from './auth-login';
import { APP_PERMISSIONS, DATASUL_SECURITY_PROGRAMS } from './app-permissions';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const ENV: LoginEnvironment = {
  DATASUL_BASE_URL: 'https://datasul.example.test',
  DATASUL_REQUEST_TIMEOUT_MS: '10000',
  APP_AUTH_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  APP_AUTH_TOKEN_TTL_MS: '60000',
  APP_OFFLINE_SESSION_TTL_MS: '30000',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function userResponse(login = 'operador', nome = 'Operador Cortag'): Response {
  return json(200, {
    total: 20,
    hasNext: true,
    items: [{ companyId: '1', code: login, name: nome, dialect: 'PT', email: '' }],
  });
}

function securityResponse(
  program: typeof DATASUL_SECURITY_PROGRAMS[number]['program'],
  access: unknown,
  login = 'operador',
): Response {
  return json(200, {
    total: 1,
    hasNext: false,
    items: [{
      codUsuario: login,
      nomUsuario: 'Nome retornado pela segurança',
      programa: program,
      temAcesso: access,
      gruposLiberados: 'NAO_CONFIAR_COMO_PERMISSAO',
    }],
  });
}

function configuredTransport(
  allowed: readonly string[] = ['fcq-0001'],
  login = 'operador',
) {
  const transport = vi.fn().mockResolvedValueOnce(userResponse(login));
  for (const { program } of DATASUL_SECURITY_PROGRAMS) {
    transport.mockResolvedValueOnce(securityResponse(program, allowed.includes(program), login));
  }
  return transport;
}

function transportWithSecurity(
  responseFor: (
    definition: typeof DATASUL_SECURITY_PROGRAMS[number],
    index: number,
  ) => Response,
) {
  const transport = vi.fn().mockResolvedValueOnce(userResponse());
  DATASUL_SECURITY_PROGRAMS.forEach((definition, index) => {
    transport.mockResolvedValueOnce(responseFor(definition, index));
  });
  return transport;
}

function dependencies(transport = configuredTransport()): LoginDependencies {
  return {
    transport,
    now: () => NOW,
    timeoutSignal: vi.fn(() => new AbortController().signal),
  };
}

describe('authenticateExternalLogin', () => {
  it('autentica em /usuarios e consulta todos os programas mapeados com paths e Basic seguros', async () => {
    const transport = configuredTransport(['fcq-0001']);

    const result = await authenticateExternalLogin(
      { login: ' operador ', senha: ' senha com : espaços ' },
      ENV,
      dependencies(transport),
    );

    expect(transport).toHaveBeenCalledTimes(1 + DATASUL_SECURITY_PROGRAMS.length);
    expect(transport.mock.calls[0]?.[0]).toBe('https://datasul.example.test/api/btb/v1/usuarios');
    expect(transport.mock.calls.slice(1).map(call => call[0])).toEqual(
      DATASUL_SECURITY_PROGRAMS.map(({ program }) =>
        `https://datasul.example.test/api/fcq/v1/seguranca/operador/${program}`),
    );
    const expectedBasic = `Basic ${Buffer.from('operador: senha com : espaços ', 'utf8').toString('base64')}`;
    for (const call of transport.mock.calls) {
      expect(call[1]).toMatchObject({
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: expectedBasic, Accept: 'application/json' },
      });
    }
    expect(result.usuario).toEqual({
      id: 'operador',
      login: 'operador',
      nome: 'Nome retornado pela segurança',
      permissoes: [APP_PERMISSIONS.mainMenu, APP_PERMISSIONS.qualityControl],
    });
    expect(result.tokenExpiresAt).toBe('2026-08-07T12:01:00.000Z');
    expect(result.offlineSessionExpiresAt).toBe('2026-08-07T12:00:30.000Z');
  });

  it.each([
    [['fma-0001'], [APP_PERMISSIONS.mainMenu, APP_PERMISSIONS.operationReporting]],
    [['fma-0001', 'fma-0003'], [APP_PERMISSIONS.mainMenu, APP_PERMISSIONS.operationReporting]],
    [['fma-0005', 'fma-0006', 'fma-0010'], [APP_PERMISSIONS.mainMenu, APP_PERMISSIONS.stoppages]],
    [['fma-0011', 'fma-0012', 'fma-0013', 'fma-0014'], [APP_PERMISSIONS.mainMenu]],
    [DATASUL_SECURITY_PROGRAMS.map(item => item.program), [
      APP_PERMISSIONS.mainMenu,
      APP_PERMISSIONS.qualityControl,
      APP_PERMISSIONS.divergentRouteAuthorization,
      APP_PERMISSIONS.operationReporting,
      APP_PERMISSIONS.batchReporting,
      APP_PERMISSIONS.stoppages,
    ]],
    [[], [APP_PERMISSIONS.mainMenu]],
  ] as const)('mapeia programas liberados %j sem impedir login', async (programs, expected) => {
    const result = await authenticateExternalLogin(
      { login: 'operador', senha: 'literal' },
      ENV,
      dependencies(configuredTransport(programs)),
    );

    expect(result.usuario.permissoes).toEqual(expected);
  });

  it('faz short-circuit após credencial inválida', async () => {
    const transport = vi.fn().mockResolvedValue(json(401, { detail: 'nao-vazar' }));

    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'incorreta' }, ENV, dependencies(transport),
    )).rejects.toMatchObject({ status: 401, code: 'invalid-credentials' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['true', 1, undefined])('rejeita temAcesso=%j não booleano', async temAcesso => {
    const transport = transportWithSecurity((definition, index) =>
      securityResponse(definition.program, index === 0 ? temAcesso : false));

    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(transport),
    )).rejects.toMatchObject({ status: 502, code: 'invalid-upstream-response' });
  });

  it.each([
    [[]],
    [[
      { codUsuario: 'operador', nomUsuario: 'Um', programa: 'fcq-0001', temAcesso: true },
      { codUsuario: 'operador', nomUsuario: 'Dois', programa: 'fcq-0001', temAcesso: true },
    ]],
    [[{ codUsuario: 'OPERADOR', nomUsuario: 'Operador', programa: 'fcq-0001', temAcesso: true }]],
    [[{ codUsuario: 'operador', nomUsuario: 'Operador', programa: 'outro', temAcesso: true }]],
  ])('falha fechado para item de segurança ausente, duplicado ou divergente', async items => {
    const transport = transportWithSecurity((definition, index) => index === 0
      ? json(200, { total: items.length, hasNext: false, items })
      : securityResponse(definition.program, false));

    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(transport),
    )).rejects.toMatchObject({ status: 502, code: 'invalid-upstream-response' });
  });

  it('não exige que o usuário esteja na primeira página do catálogo /usuarios', async () => {
    const transport = vi.fn().mockResolvedValueOnce(userResponse('outro', 'Outro usuário'));
    for (const { program } of DATASUL_SECURITY_PROGRAMS) {
      transport.mockResolvedValueOnce(securityResponse(program, program === 'fcq-0001'));
    }

    const result = await authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(transport),
    );

    expect(result.usuario).toMatchObject({
      login: 'operador',
      nome: 'Nome retornado pela segurança',
    });
  });

  it('codifica individualmente usuário e programa no path', async () => {
    const transport = configuredTransport([], 'op/ç');

    await authenticateExternalLogin(
      { login: ' op/ç ', senha: 'literal' }, ENV, dependencies(transport),
    );

    expect(transport.mock.calls[1]?.[0]).toContain('/op%2F%C3%A7/fcq-0001');
  });

  it.each([
    [{ login: 'op:erador', senha: 'literal' }, 401, 'invalid-credentials'],
    [{ login: 'opera\ndor', senha: 'literal' }, 401, 'invalid-credentials'],
    [{ login: 'operador', senha: '' }, 401, 'invalid-credentials'],
  ] as const)('rejeita credencial local inválida', async (input, status, code) => {
    const transport = vi.fn();
    await expect(authenticateExternalLogin(input, ENV, dependencies(transport)))
      .rejects.toMatchObject({ status, code });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...ENV, DATASUL_BASE_URL: 'ftp://datasul.test' }],
    [{ ...ENV, DATASUL_BASE_URL: 'https://user:pass@datasul.test' }],
    [{ ...ENV, APP_AUTH_TOKEN_SECRET: 'curto' }],
    [{ ...ENV, APP_AUTH_TOKEN_SECRET: 'replace-with-a-managed-secret' }],
    [{ ...ENV, APP_AUTH_TOKEN_TTL_MS: '0' }],
    [{ ...ENV, APP_AUTH_TOKEN_TTL_MS: String(Number.MAX_SAFE_INTEGER) }],
    [{ ...ENV, APP_OFFLINE_SESSION_TTL_MS: String(Number.MAX_SAFE_INTEGER) }],
    [{ ...ENV, DATASUL_REQUEST_TIMEOUT_MS: 'NaN' }],
    [{ ...ENV, DATASUL_REQUEST_TIMEOUT_MS: String(Number.MAX_SAFE_INTEGER) }],
  ])('falha fechado para configuração ausente ou insegura', async invalidEnv => {
    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, invalidEnv, dependencies(),
    )).rejects.toMatchObject({ status: 503, code: 'auth-gateway-not-configured' });
  });

  it('limita a continuidade offline à expiração online e permite desabilitá-la', async () => {
    const capped = await authenticateExternalLogin(
      { login: 'operador', senha: 'literal' },
      { ...ENV, APP_OFFLINE_SESSION_TTL_MS: '120000' }, dependencies(),
    );
    const disabled = await authenticateExternalLogin(
      { login: 'operador', senha: 'literal' },
      { ...ENV, APP_OFFLINE_SESSION_TTL_MS: '0' }, dependencies(),
    );

    expect(capped.offlineSessionExpiresAt).toBe(capped.tokenExpiresAt);
    expect(disabled).not.toHaveProperty('offlineSessionExpiresAt');
  });

  it('não inclui credenciais ou respostas Datasul em erros serializados', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('raw upstream secret-value'));

    const error = await authenticateExternalLogin(
      { login: 'operador', senha: 'secret-value' }, ENV, dependencies(transport),
    ).catch(value => value as AuthLoginError);

    expect(JSON.stringify(error)).toBe('{"status":502,"code":"datasul-unavailable"}');
  });

  it.each([
    [403, 'datasul-unavailable'],
    [500, 'datasul-unavailable'],
  ] as const)('mapeia status %i de /usuarios sem ecoar upstream', async (status, code) => {
    const transport = vi.fn().mockResolvedValue(json(status, { detail: 'interno' }));
    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(transport),
    )).rejects.toMatchObject({ status: 502, code });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 401, 'invalid-credentials'],
    [403, 502, 'datasul-unavailable'],
    [500, 502, 'datasul-unavailable'],
  ] as const)('mapeia status %i de /seguranca', async (upstreamStatus, status, code) => {
    const transport = transportWithSecurity((definition, index) => index === 0
      ? json(upstreamStatus, { detail: 'interno' })
      : securityResponse(definition.program, false));
    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(transport),
    )).rejects.toMatchObject({ status, code });
  });

  it.each([
    new Response('{invalido', { status: 200, headers: { 'content-type': 'application/json' } }),
    json(200, { total: '1', hasNext: false, items: [] }),
    json(200, { total: 1, hasNext: 'false', items: [] }),
    json(200, { total: 1, hasNext: false, items: {} }),
  ])('rejeita JSON ou envelope upstream inválido', async invalidResponse => {
    const transport = vi.fn().mockResolvedValue(invalidResponse);
    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(transport),
    )).rejects.toMatchObject({ status: 502, code: 'invalid-upstream-response' });
  });

  it('distingue timeout cancelado de falha de rede', async () => {
    const timeoutTransport = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const networkTransport = vi.fn().mockRejectedValue(new TypeError('network'));

    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(timeoutTransport),
    )).rejects.toMatchObject({ status: 504, code: 'datasul-timeout' });
    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV, dependencies(networkTransport),
    )).rejects.toMatchObject({ status: 502, code: 'datasul-unavailable' });
  });

  it('não emite token quando alguma resposta de autorização é inválida', async () => {
    const issueToken = vi.fn();
    const transport = transportWithSecurity((definition, index) => index === 0
      ? securityResponse(definition.program, 'true')
      : securityResponse(definition.program, false));

    await expect(authenticateExternalLogin(
      { login: 'operador', senha: 'literal' }, ENV,
      { ...dependencies(transport), issueToken },
    )).rejects.toMatchObject({ status: 502, code: 'invalid-upstream-response' });
    expect(issueToken).not.toHaveBeenCalled();
  });
});
