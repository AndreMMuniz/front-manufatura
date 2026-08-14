import { describe, expect, it } from 'vitest';

import { authenticateAndAuthorizeDatasul } from './datasul-auth-client';
import type { ApplicationLogger } from './logging/log-contracts';
import {
  QualityControlDatasulClient,
  QualityControlGatewayError,
  type QualityControlDatasulConfig,
} from './quality-control-datasul-client';

function sink() {
  const events: Array<{ level: string; event: string; metadata?: Record<string, unknown> }> = [];
  const make = (level: string) => (event: string, metadata?: Record<string, unknown>) => {
    events.push({ level, event, metadata });
  };
  return {
    events,
    logger: {
      debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error'),
      close: () => Promise.resolve(),
    } satisfies ApplicationLogger,
  };
}

const qualityConfig: QualityControlDatasulConfig = {
  baseUrl: new URL('http://10.101.195.111:51080'),
  companyId: 1,
  integrationUser: 'integracao-sentinela',
  integrationPassword: 'senha-sentinela',
  requestTimeoutMs: 100,
};

describe('instrumentação dos clientes Datasul', () => {
  it('autenticação registra rotas normalizadas sem login, senha ou Basic Auth', async () => {
    const target = sink();
    const login = 'usuario-sentinela';
    const transport = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/btb/v1/usuarios') {
        return Response.json({ items: [], hasNext: false, total: 0 });
      }
      const program = decodeURIComponent(url.pathname.split('/').at(-1)!);
      return Response.json({
        items: [{ codUsuario: login, programa: program, nomUsuario: 'Pessoa', temAcesso: true }],
        hasNext: false,
        total: 1,
      });
    };

    await authenticateAndAuthorizeDatasul(login, 'senha-login-sentinela', {
      baseUrl: qualityConfig.baseUrl.toString(), requestTimeoutMs: 100,
    }, { transport, timeoutSignal: AbortSignal.timeout, logger: target.logger });

    const serialized = JSON.stringify(target.events);
    expect(serialized).toContain('/api/fcq/v1/seguranca/:usuario/:programa');
    expect(serialized).not.toMatch(/usuario-sentinela|senha-login-sentinela|Basic/);
  });

  it('CQ registra sucesso e status não-OK sem query ou payload', async () => {
    const target = sink();
    const success = new QualityControlDatasulClient(
      qualityConfig, async () => Response.json({ ok: true }), AbortSignal.timeout, target.logger,
    );
    await success.saveResult({ resultado: 346, observacao: 'observacao-sentinela' });

    const failed = new QualityControlDatasulClient(
      qualityConfig, async () => new Response('{}', { status: 503 }), AbortSignal.timeout, target.logger,
    );
    await expect(failed.getRoute({ nrOrdemProducao: 123456, codOperacao: 10 }))
      .rejects.toEqual(expect.objectContaining({ status: 503, code: 'datasul-request-failed' }));

    const serialized = JSON.stringify(target.events);
    expect(serialized).toContain('save_quality_result');
    expect(serialized).toContain('http_error');
    expect(serialized).not.toMatch(/346|observacao-sentinela|companyId|senha-sentinela|integracao-sentinela/);
  });

  it('CQ classifica timeout e JSON inválido sem registrar mensagem bruta', async () => {
    const timeoutSink = sink();
    const timeoutError = Object.assign(new Error('Bearer segredo-sentinela'), { name: 'TimeoutError' });
    const timeout = new QualityControlDatasulClient(
      qualityConfig, async () => { throw timeoutError; }, AbortSignal.timeout, timeoutSink.logger,
    );
    await expect(timeout.getOrder(987654)).rejects.toEqual(
      expect.objectContaining({ status: 504, code: 'datasul-timeout' }),
    );
    expect(JSON.stringify(timeoutSink.events)).toContain('timeout');
    expect(JSON.stringify(timeoutSink.events)).not.toMatch(/987654|segredo-sentinela/);

    const invalidSink = sink();
    const invalid = new QualityControlDatasulClient(
      qualityConfig, async () => new Response('não-json', { status: 200 }), AbortSignal.timeout,
      invalidSink.logger,
    );
    await expect(invalid.finalizeRoute({ nrFicha: 444444, codUsuario: 'usuario-secreto' }))
      .rejects.toBeInstanceOf(QualityControlGatewayError);
    expect(JSON.stringify(invalidSink.events)).toContain('invalid_response');
    expect(JSON.stringify(invalidSink.events)).not.toMatch(/444444|usuario-secreto|não-json/);
  });
});
