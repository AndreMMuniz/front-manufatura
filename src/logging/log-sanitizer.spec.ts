import { describe, expect, it } from 'vitest';

import { sanitizeLogMetadata, sanitizeLogText } from './log-sanitizer';

describe('log sanitizer', () => {
  it('remove segredos, payloads e respostas em qualquer profundidade', () => {
    const result = sanitizeLogMetadata({
      method: 'PUT',
      authorization: 'Bearer token-secreto',
      nested: {
        senha: 'segredo',
        cookie: 'session=abc',
        payload: { resultado: 346 },
        responseBody: { token: 'abc' },
        safeCode: 'DATASUL_TIMEOUT',
      },
    });

    expect(result).toEqual({
      method: 'PUT',
      authorization: '[REDACTED]',
      nested: {
        senha: '[REDACTED]',
        cookie: '[REDACTED]',
        payload: '[REDACTED]',
        responseBody: '[REDACTED]',
        safeCode: 'DATASUL_TIMEOUT',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/token-secreto|session=abc|346|"abc"/);
  });

  it('normaliza Error, ciclos, profundidade e tamanhos sem lançar', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;
    const error = new Error(`falha ${'x'.repeat(2_000)}`);
    error.stack = `stack ${'y'.repeat(8_000)}`;

    const result = sanitizeLogMetadata({ cyclic, error, deep: { a: { b: { c: { d: 1 } } } } });

    expect(result['cyclic']).toEqual({ name: 'root', self: '[CIRCULAR]' });
    expect(result['error']).toEqual(expect.objectContaining({ name: 'Error' }));
    expect(JSON.stringify(result['error']).length).toBeLessThan(5_500);
    expect(JSON.stringify(result)).toContain('[MAX_DEPTH]');
  });

  it('remove credenciais presentes em texto e limita mensagem/stack', () => {
    expect(sanitizeLogText(
      'Authorization: Bearer abc senha=123 https://user:pass@example.test eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.signature\nforjado',
      1_000,
    )).not.toMatch(/abc|123|user|pass|eyJ|\n/);
    expect(sanitizeLogText('m'.repeat(1_500), 1_000)).toHaveLength(1_000);
  });

  it('não avalia getters e remove campos de negócio sensíveis', () => {
    const source = {
      resultado: 346,
      observacao: 'detalhe de fabricação',
      get dangerous() {
        throw new Error('getter-executado');
      },
    };

    expect(() => sanitizeLogMetadata(source)).not.toThrow();
    expect(sanitizeLogMetadata(source)).toEqual({
      resultado: '[REDACTED]',
      observacao: '[REDACTED]',
      dangerous: '[ACCESSOR]',
    });
  });

  it('não permite sobrescrever campos reservados do envelope', () => {
    expect(sanitizeLogMetadata({
      level: 'error', message: 'senha=segredo', timestamp: 'forjado', status: 200,
    })).toEqual({ status: 200 });
  });

  it('não avalia getters maliciosos em Error', () => {
    const error = new Error('seguro');
    Object.defineProperty(error, 'code', { get: () => { throw new Error('não avaliar'); } });
    expect(() => sanitizeLogMetadata({ error })).not.toThrow();
    expect(sanitizeLogMetadata({ error })).toEqual(expect.objectContaining({
      error: expect.objectContaining({ message: 'seguro' }),
    }));
  });
});
