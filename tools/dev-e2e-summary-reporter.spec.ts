import { describe, expect, it } from 'vitest';

import DevE2eSummaryReporter, {
  formatE2eRunSummary,
  type E2eRunSummary,
} from './dev-e2e-summary-reporter';

function createSummary(overrides: Partial<E2eRunSummary> = {}): E2eRunSummary {
  return {
    status: 'passed',
    durationMs: 12_340,
    total: 12,
    passed: 12,
    failed: 0,
    skipped: 0,
    flaky: 0,
    interrupted: 0,
    slow: [],
    failures: [],
    flakyTests: [],
    skippedTests: [],
    externalErrors: [],
    markdownPath: 'test-results/relatorio-e2e.md',
    htmlPath: 'playwright-report/index.html',
    ...overrides,
  };
}

describe('formatE2eRunSummary', () => {
  it('resume uma execução aprovada e informa onde consultar os relatórios locais', () => {
    const output = formatE2eRunSummary(createSummary());

    expect(output).toContain('RESULTADO GERAL: APROVADO');
    expect(output).toContain('12 aprovados');
    expect(output).toContain('Duração: 12.34 s');
    expect(output).toContain('Relatório Markdown: test-results/relatorio-e2e.md');
    expect(output).toContain('Relatório HTML: playwright-report/index.html');
  });

  it('explica a falha com comportamento, navegador, localização e evidências', () => {
    const output = formatE2eRunSummary(
      createSummary({
        status: 'failed',
        total: 1,
        passed: 0,
        failed: 1,
        failures: [
          {
            title: 'Login > bloqueia senha inválida',
            projectName: 'chromium',
            file: 'tests/login.spec.ts',
            line: 42,
            column: 7,
            durationMs: 30_100,
            retry: 0,
            message:
              'TimeoutError: locator.click: Timeout 30000ms exceeded while waiting for getByRole("button")',
            snippet: '40 | await entrar.click();',
            attachments: [
              { name: 'screenshot', path: 'test-results/login/test-failed-1.png' },
              { name: 'trace', path: 'test-results/login/trace.zip' },
            ],
          },
        ],
      }),
    );

    expect(output).toContain('Comportamento: Login > bloqueia senha inválida');
    expect(output).toContain('Navegador/projeto: chromium');
    expect(output).toContain('tests/login.spec.ts:42:7');
    expect(output).toContain('Causa informada: TimeoutError: locator.click');
    expect(output).toContain('Leitura para correção: o elemento esperado não ficou disponível');
    expect(output).toContain('test-results/login/test-failed-1.png');
    expect(output).toContain('test-results/login/trace.zip');
  });

  it('destaca testes instáveis, ignorados e lentos como pontos de atenção', () => {
    const output = formatE2eRunSummary(
      createSummary({
        total: 4,
        passed: 2,
        skipped: 1,
        flaky: 1,
        flakyTests: [
          { title: 'sincroniza depois da reconexão', projectName: 'firefox', retries: 1 },
        ],
        skippedTests: [
          { title: 'funciona offline', projectName: 'webkit', reason: 'Correção pendente' },
        ],
        slow: [
          {
            title: 'carrega ordens',
            projectName: 'chromium',
            durationMs: 16_200,
            file: 'tests/orders.spec.ts',
            line: 18,
          },
        ],
      }),
    );

    expect(output).toContain('PONTOS DE ATENÇÃO');
    expect(output).toContain('Instável: sincroniza depois da reconexão [firefox]');
    expect(output).toContain('Ignorado: funciona offline [webkit] — Correção pendente');
    expect(output).toContain('Lento: carrega ordens [chromium] — 16.20 s');
  });

  it('explica erros externos e execuções interrompidas sem falso sucesso', () => {
    const output = formatE2eRunSummary(
      createSummary({
        status: 'timedout',
        total: 2,
        passed: 1,
        interrupted: 1,
        externalErrors: ['O servidor web não iniciou na porta 4201.'],
      }),
    );

    expect(output).toContain('RESULTADO GERAL: REPROVADO');
    expect(output).toContain('A execução excedeu o tempo limite global');
    expect(output).toContain('ERROS FORA DOS TESTES');
    expect(output).toContain('O servidor web não iniciou na porta 4201.');
    expect(output).toContain(
      'Próximo passo: resolva primeiro o erro de infraestrutura listado acima',
    );
    expect(output).not.toContain('falha de número 1');
  });

  it('remove códigos ANSI e limita mensagens muito longas sem esconder sua origem', () => {
    const output = formatE2eRunSummary(
      createSummary({
        status: 'failed',
        total: 1,
        failed: 1,
        passed: 0,
        failures: [
          {
            title: 'compara o título',
            projectName: 'webkit',
            file: 'tests/title.spec.ts',
            durationMs: 20,
            retry: 0,
            message: `\u001b[31mExpected: "Menu"\nReceived: "Login"\u001b[39m\n${'detalhe '.repeat(300)}`,
            attachments: [],
          },
        ],
      }),
    );

    expect(output).not.toContain('\u001b[31m');
    expect(output).toContain('Leitura para correção: o valor exibido ficou diferente do esperado');
    expect(output).toContain(
      '[mensagem reduzida; consulte o relatório HTML para o detalhe completo]',
    );
  });
});

describe('DevE2eSummaryReporter', () => {
  it('consolida o resultado final no terminal e no arquivo Markdown configurado', async () => {
    let terminalOutput = '';
    let markdownOutput = '';
    let markdownPath = '';
    const reporter = new DevE2eSummaryReporter({
      outputFile: 'test-results/relatorio-e2e.md',
      write: (text) => (terminalOutput += text),
      writeMarkdown: (path, text) => {
        markdownPath = path;
        markdownOutput = text;
      },
      slowTestMs: 15_000,
    });
    const project = { name: 'chromium' };
    const failedResult = {
      status: 'failed',
      duration: 30_050,
      retry: 0,
      errors: [
        {
          message: 'Expected: "Menu"\nReceived: "Login"',
          location: { file: 'tests/menu.spec.ts', line: 21, column: 5 },
          snippet: '20 | await expect(title).toHaveText("Menu");',
        },
      ],
      attachments: [
        {
          name: 'screenshot',
          contentType: 'image/png',
          path: 'test-results/menu/test-failed-1.png',
        },
      ],
    };
    const flakyResult = {
      status: 'passed',
      duration: 800,
      retry: 1,
      errors: [],
      attachments: [],
    };
    const tests = [
      {
        id: 'failed',
        expectedStatus: 'passed',
        location: { file: 'tests/menu.spec.ts', line: 18, column: 1 },
        annotations: [],
        results: [failedResult],
        titlePath: () => ['', 'chromium', 'menu.spec.ts', 'Menu', 'mostra o título'],
        outcome: () => 'unexpected',
        parent: { project: () => project },
      },
      {
        id: 'flaky',
        expectedStatus: 'passed',
        location: { file: 'tests/sync.spec.ts', line: 7, column: 1 },
        annotations: [],
        results: [{ ...failedResult, duration: 500 }, flakyResult],
        titlePath: () => ['', 'chromium', 'sync.spec.ts', 'sincroniza novamente'],
        outcome: () => 'flaky',
        parent: { project: () => project },
      },
      {
        id: 'skipped',
        expectedStatus: 'skipped',
        location: { file: 'tests/offline.spec.ts', line: 9, column: 1 },
        annotations: [{ type: 'skip', description: 'Depende do serviço externo' }],
        results: [],
        titlePath: () => ['', 'chromium', 'offline.spec.ts', 'opera sem rede'],
        outcome: () => 'skipped',
        parent: { project: () => project },
      },
    ];

    reporter.onBegin({} as never, { allTests: () => tests } as never);
    reporter.onError({ message: 'Falha global de preparação' });
    await reporter.onEnd({
      status: 'failed',
      duration: 31_000,
      startTime: new Date('2026-08-19T10:00:00Z'),
    });

    expect(terminalOutput).toContain('1 com falha | 1 instáveis | 1 ignorados | 3 no total');
    expect(terminalOutput).toContain('tests/menu.spec.ts:21:5');
    expect(terminalOutput).toContain('Falha global de preparação');
    expect(markdownPath).toBe('test-results/relatorio-e2e.md');
    expect(markdownOutput).toContain('# Relatório E2E');
    expect(markdownOutput).toContain('```text');
    expect(markdownOutput).toContain(terminalOutput.trim());
    expect(markdownOutput).not.toBe(terminalOutput);
  });

  it('não gera relatório quando o Playwright apenas lista testes sem executá-los', () => {
    let writes = 0;
    const reporter = new DevE2eSummaryReporter({
      write: () => writes++,
      writeMarkdown: () => writes++,
    });
    const discoveredTest = {
      title: 'somente descoberto',
      titlePath: () => ['', 'chromium', 'discovery.spec.ts', 'somente descoberto'],
      parent: { project: () => ({ name: 'chromium' }) },
      location: { file: 'tests/discovery.spec.ts', line: 1, column: 1 },
      annotations: [],
      results: [],
      outcome: () => 'skipped',
    };

    reporter.onBegin({} as never, { allTests: () => [discoveredTest] } as never);
    reporter.onEnd({
      status: 'passed',
      duration: 10,
      startTime: new Date('2026-08-19T10:00:00Z'),
    });

    expect(writes).toBe(0);
  });
});
