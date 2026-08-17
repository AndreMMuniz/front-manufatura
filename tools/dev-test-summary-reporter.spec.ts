import { describe, expect, it } from 'vitest';

import DevTestSummaryReporter, {
  formatTestRunSummary,
  type TestRunSummary,
} from './dev-test-summary-reporter';

class FakeRuntime {
  exitCode: number | undefined;
  listener?: (code: number) => void;

  getExitCode(): number | undefined {
    return this.exitCode;
  }

  onExit(listener: (code: number) => void): void {
    this.listener = listener;
  }

  offExit(listener: (code: number) => void): void {
    if (this.listener === listener) this.listener = undefined;
  }

  exit(code: number): void {
    this.exitCode = code;
    this.listener?.(code);
  }
}

function createSummary(overrides: Partial<TestRunSummary> = {}): TestRunSummary {
  return {
    reason: 'passed',
    durationMs: 38_960,
    files: { passed: 100, failed: 0, skipped: 0, pending: 0 },
    tests: { passed: 988, failed: 0, skipped: 0, todo: 0, pending: 0 },
    failures: [],
    externalErrors: [],
    coverageFailed: false,
    exitCodeFailed: false,
    coverageHtmlPath: 'coverage/plano-de-controle/index.html',
    ...overrides,
  };
}

describe('formatTestRunSummary', () => {
  it('explica uma execução aprovada com totais, duração e relatório HTML', () => {
    const output = formatTestRunSummary(createSummary());

    expect(output).toContain('RESULTADO GERAL: APROVADO');
    expect(output).toContain('Arquivos: 100 aprovados');
    expect(output).toContain('Testes:   988 aprovados');
    expect(output).toContain('Duração: 38.96 s');
    expect(output).toContain('Cobertura HTML: coverage/plano-de-controle/index.html');
    expect(output).not.toContain('FALHAS ENCONTRADAS');
  });

  it('detalha comportamento, localização, duração e causa de cada falha', () => {
    const output = formatTestRunSummary(
      createSummary({
        reason: 'failed',
        files: { passed: 100, failed: 2, skipped: 0, pending: 0 },
        tests: { passed: 988, failed: 2, skipped: 0, todo: 0, pending: 0 },
        failures: [
          {
            name: 'Pedido > deve impedir envio sem cliente',
            file: 'src/app/pedido/pedido.spec.ts',
            line: 42,
            column: 7,
            durationMs: 125,
            messages: ['esperava true, mas recebeu false'],
          },
        ],
      }),
    );

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('Comportamento: Pedido > deve impedir envio sem cliente');
    expect(output).toContain('src/app/pedido/pedido.spec.ts:42:7');
    expect(output).toContain('Duração do teste: 125 ms');
    expect(output).toContain('Causa: esperava true, mas recebeu false');
    expect(output).toContain('Cobertura HTML: não gerada');
  });

  it('mantém mensagens multilinha indentadas e coordenadas iguais a zero', () => {
    const output = formatTestRunSummary(
      createSummary({
        reason: 'failed',
        files: { passed: 0, failed: 1, skipped: 0, pending: 0 },
        tests: { passed: 0, failed: 1, skipped: 0, todo: 0, pending: 0 },
        failures: [
          {
            name: 'caso limite',
            file: 'src/caso.spec.ts',
            line: 0,
            column: 0,
            messages: ['primeira linha\nsegunda linha'],
          },
        ],
      }),
    );

    expect(output).toContain('src/caso.spec.ts:0:0');
    expect(output).toContain('Causa: primeira linha\n          segunda linha');
  });

  it('separa ignorados e TODO e reprova resultados pendentes', () => {
    const output = formatTestRunSummary(
      createSummary({
        files: { passed: 1, failed: 0, skipped: 1, pending: 1 },
        tests: { passed: 2, failed: 0, skipped: 2, todo: 1, pending: 1 },
      }),
    );

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('3 ignorados');
    expect(output).toContain('1 marcados como TODO');
    expect(output).toContain('1 testes e 1 arquivos não concluíram');
    expect(output).toContain('resultados pendentes');
  });

  it('explica erros externos sem apresentar sucesso falso', () => {
    const output = formatTestRunSummary(
      createSummary({
        reason: 'failed',
        files: { passed: 0, failed: 1, skipped: 0, pending: 0 },
        tests: { passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0 },
        externalErrors: ['Não foi possível importar src/app/app.spec.ts'],
      }),
    );

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('ERROS FORA DOS TESTES');
    expect(output).toContain('Não foi possível importar');
  });

  it('reprova quando o limite de cobertura falha mesmo com os testes aprovados', () => {
    const output = formatTestRunSummary(
      createSummary({ coverageFailed: true, exitCodeFailed: true }),
    );

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('COBERTURA: REPROVADA');
    expect(output).toContain('Cobertura HTML: coverage/plano-de-controle/index.html');
  });
});

describe('DevTestSummaryReporter', () => {
  it('aceita o objeto de opções fornecido pelo carregador de reporters do Vitest', () => {
    const runtime = new FakeRuntime();
    let output = '';
    const reporter = new DevTestSummaryReporter({
      write: (text) => (output += text),
      runtime,
    });

    reporter.onTestRunEnd([], [{ message: 'falha carregada' }], 'failed');

    expect(output).toContain('falha carregada');
  });

  it('preserva o código de saída definido pelo runner', () => {
    const runtime = new FakeRuntime();
    runtime.exitCode = 23;
    let output = '';
    const reporter = new DevTestSummaryReporter((text) => (output += text), runtime);

    reporter.onTestRunEnd([], [{ message: 'falha de coleta' }], 'failed');

    expect(runtime.exitCode).toBe(23);
    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('falha de coleta');
  });

  it('interpreta o código de saída textual zero como sucesso', () => {
    const runtime = new FakeRuntime();
    let output = '';
    const reporter = new DevTestSummaryReporter((text) => (output += text), runtime);

    reporter.onInit({ config: { coverage: { enabled: true } } } as never);
    reporter.onTestRunStart();
    runtime.exitCode = '0' as never;
    reporter.onTestRunEnd([], [], 'passed');
    reporter.onFinishedReportCoverage();

    expect(output).toContain('RESULTADO GERAL: APROVADO');
  });

  it('imprime fallback reprovado quando o processo encerra antes do resultado final', () => {
    const runtime = new FakeRuntime();
    let output = '';
    new DevTestSummaryReporter((text) => (output += text), runtime);

    runtime.exit(7);

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('antes de o Vitest entregar os resultados completos');
    expect(output).toContain('código 7');
  });

  it('não aprova cobertura que encerra sem chamar o hook final', () => {
    const runtime = new FakeRuntime();
    let output = '';
    const reporter = new DevTestSummaryReporter((text) => (output += text), runtime);

    reporter.onInit({ config: { coverage: { enabled: true } } } as never);
    reporter.onTestRunStart();
    reporter.onTestRunEnd([], [], 'passed');
    runtime.exit(0);

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('antes da confirmação do resultado final');
  });

  it('marca timeout como interrupção mesmo após receber resultados parciais', () => {
    const runtime = new FakeRuntime();
    let output = '';
    const reporter = new DevTestSummaryReporter((text) => (output += text), runtime);

    reporter.onInit({ config: { coverage: { enabled: true } } } as never);
    reporter.onTestRunStart();
    reporter.onTestRunEnd([], [], 'passed');
    reporter.onProcessTimeout();

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('excedeu o tempo limite');
    expect(output).toContain('execução foi interrompida');
  });

  it('usa o exit code anterior à cobertura como baseline da classificação', () => {
    const runtime = new FakeRuntime();
    runtime.exitCode = 9;
    let output = '';
    const reporter = new DevTestSummaryReporter((text) => (output += text), runtime);

    reporter.onInit({ config: { coverage: { enabled: true } } } as never);
    reporter.onTestRunStart();
    reporter.onTestRunEnd([], [], 'passed');
    expect(output).toBe('');
    reporter.onFinishedReportCoverage();

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).not.toContain('COBERTURA: REPROVADA');
    expect(runtime.exitCode).toBe(9);
  });

  it('atribui à cobertura apenas o exit code que surgiu após os testes', () => {
    const runtime = new FakeRuntime();
    runtime.exitCode = 0;
    let output = '';
    const reporter = new DevTestSummaryReporter((text) => (output += text), runtime);

    reporter.onInit({ config: { coverage: { enabled: true } } } as never);
    reporter.onTestRunStart();
    reporter.onTestRunEnd([], [], 'passed');
    expect(output).toBe('');

    runtime.exitCode = 1;
    reporter.onFinishedReportCoverage();

    expect(output).toContain('COBERTURA: REPROVADA');
    expect(runtime.exitCode).toBe(1);
  });
});
