import { mkdirSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
} from '@playwright/test/reporter';

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const MAX_ERROR_LENGTH = 1_600;
const DEFAULT_OUTPUT_FILE = 'test-results/relatorio-e2e.md';
const DEFAULT_HTML_FILE = 'playwright-report/index.html';
const DEFAULT_SLOW_TEST_MS = 15_000;

export type E2eRunStatus = 'passed' | 'failed' | 'timedout' | 'interrupted';

export interface E2eAttachmentSummary {
  name: string;
  path: string;
}

export interface E2eFailureSummary {
  title: string;
  projectName: string;
  file: string;
  line?: number;
  column?: number;
  durationMs: number;
  retry: number;
  message: string;
  snippet?: string;
  attachments: E2eAttachmentSummary[];
}

export interface E2eAttentionSummary {
  title: string;
  projectName: string;
}

export interface E2eFlakySummary extends E2eAttentionSummary {
  retries: number;
}

export interface E2eSkippedSummary extends E2eAttentionSummary {
  reason?: string;
}

export interface E2eSlowSummary extends E2eAttentionSummary {
  durationMs: number;
  file: string;
  line?: number;
}

export interface E2eRunSummary {
  status: E2eRunStatus;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  interrupted: number;
  slow: E2eSlowSummary[];
  failures: E2eFailureSummary[];
  flakyTests: E2eFlakySummary[];
  skippedTests: E2eSkippedSummary[];
  externalErrors: string[];
  markdownPath: string;
  htmlPath: string;
}

export interface DevE2eSummaryReporterOptions {
  outputFile?: string;
  htmlPath?: string;
  slowTestMs?: number;
  write?: (text: string) => void;
  writeMarkdown?: (path: string, text: string) => void;
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'duração indisponível';
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(2)} s`;
}

function formatLocation(file: string, line?: number, column?: number): string {
  if (line === undefined) return file;
  return `${file}:${line}${column !== undefined ? `:${column}` : ''}`;
}

function normalizeMessage(message: string): string {
  const clean = message.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n').trim();
  if (clean.length <= MAX_ERROR_LENGTH) return clean || 'O Playwright não informou uma mensagem.';
  return `${clean.slice(0, MAX_ERROR_LENGTH).trimEnd()}\n[mensagem reduzida; consulte o relatório HTML para o detalhe completo]`;
}

function indent(message: string): string {
  return message.replace(/\n/g, '\n      ');
}

function interpretFailure(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('timeouterror') ||
    normalized.includes('timeout') ||
    normalized.includes('waiting for')
  ) {
    return 'o elemento esperado não ficou disponível dentro do tempo limite. Confira se a tela abriu, se o seletor ainda corresponde ao elemento e se alguma requisição ficou pendente.';
  }
  if (normalized.includes('strict mode violation')) {
    return 'o seletor encontrou mais de um elemento. Torne a busca mais específica para identificar somente o controle desejado.';
  }
  if (
    normalized.includes('expected:') ||
    normalized.includes('received:') ||
    normalized.includes('expect(')
  ) {
    return 'o valor exibido ficou diferente do esperado. Compare “Expected” e “Received” e verifique o estado que alimenta essa parte da tela.';
  }
  if (
    normalized.includes('econnrefused') ||
    normalized.includes('net::err_') ||
    normalized.includes('webserver')
  ) {
    return 'a aplicação ou um serviço necessário não respondeu. Confirme servidor, porta e dependências antes de alterar o comportamento testado.';
  }
  return 'a causa automática não pôde ser classificada com segurança. Comece pela localização, pela mensagem do Playwright e pelas evidências listadas abaixo.';
}

export function formatE2eRunSummary(summary: E2eRunSummary): string {
  const succeeded =
    summary.status === 'passed' && summary.failed === 0 && summary.interrupted === 0;
  const lines = [
    '',
    '════════════════ RELATÓRIO E2E ═════════════════════',
    succeeded ? 'RESULTADO GERAL: APROVADO ✓' : 'RESULTADO GERAL: REPROVADO ✗',
    '',
    `Testes: ${summary.passed} aprovados | ${summary.failed} com falha | ${summary.flaky} instáveis | ${summary.skipped} ignorados | ${summary.total} no total`,
    `Duração: ${formatDuration(summary.durationMs)}`,
  ];

  if (summary.status === 'timedout') {
    lines.push('Situação: A execução excedeu o tempo limite global e não conseguiu concluir.');
  } else if (summary.status === 'interrupted') {
    lines.push('Situação: A execução foi interrompida antes de concluir.');
  } else if (summary.interrupted > 0) {
    lines.push(`Situação: ${summary.interrupted} teste(s) não concluíram a execução.`);
  }

  if (summary.failures.length > 0) {
    lines.push('', `FALHAS ENCONTRADAS (${summary.failures.length})`);
    summary.failures.forEach((failure, index) => {
      const message = normalizeMessage(failure.message);
      lines.push('', `${index + 1}. Comportamento: ${failure.title}`);
      lines.push(`   Navegador/projeto: ${failure.projectName}`);
      lines.push(
        `   Onde investigar: ${formatLocation(failure.file, failure.line, failure.column)}`,
      );
      lines.push(`   Duração: ${formatDuration(failure.durationMs)}`);
      if (failure.retry > 0) lines.push(`   Tentativa: ${failure.retry + 1}`);
      lines.push(`   Causa informada: ${indent(message)}`);
      lines.push(`   Leitura para correção: ${interpretFailure(message)}`);
      if (failure.snippet)
        lines.push(`   Trecho relacionado: ${indent(normalizeMessage(failure.snippet))}`);
      if (failure.attachments.length > 0) {
        lines.push('   Evidências locais:');
        failure.attachments.forEach((attachment) => {
          lines.push(`   - ${attachment.name}: ${attachment.path}`);
        });
      }
    });
  }

  if (summary.externalErrors.length > 0) {
    lines.push('', 'ERROS FORA DOS TESTES');
    summary.externalErrors.forEach((error) => lines.push(`- ${indent(normalizeMessage(error))}`));
  }

  if (summary.flakyTests.length > 0 || summary.skippedTests.length > 0 || summary.slow.length > 0) {
    lines.push('', 'PONTOS DE ATENÇÃO');
    summary.flakyTests.forEach((test) => {
      lines.push(
        `- Instável: ${test.title} [${test.projectName}] — passou após ${test.retries} nova(s) tentativa(s).`,
      );
    });
    summary.skippedTests.forEach((test) => {
      lines.push(
        `- Ignorado: ${test.title} [${test.projectName}]${test.reason ? ` — ${test.reason}` : ' — sem justificativa informada.'}`,
      );
    });
    summary.slow.forEach((test) => {
      lines.push(
        `- Lento: ${test.title} [${test.projectName}] — ${formatDuration(test.durationMs)} — ${formatLocation(test.file, test.line)}`,
      );
    });
  }

  lines.push(
    '',
    `Relatório Markdown: ${summary.markdownPath}`,
    `Relatório HTML: ${summary.htmlPath}`,
  );

  if (!succeeded && summary.failures.length > 0) {
    lines.push(
      '',
      'Próximo passo: corrija primeiro a falha de número 1, execute novamente o mesmo comando `make` e confirme se as falhas seguintes permanecem.',
    );
  } else if (!succeeded && summary.externalErrors.length > 0) {
    lines.push(
      '',
      'Próximo passo: resolva primeiro o erro de infraestrutura listado acima e execute novamente o mesmo comando `make`.',
    );
  } else if (!succeeded) {
    lines.push(
      '',
      'Próximo passo: confirme por que a execução foi interrompida e execute novamente o mesmo comando `make`.',
    );
  } else if (summary.flaky > 0 || summary.skipped > 0 || summary.slow.length > 0) {
    lines.push(
      '',
      'Próximo passo: a suíte passou, mas revise os pontos de atenção antes de encerrar a tarefa.',
    );
  }

  lines.push('══════════════════════════════════════════════════════', '');
  return lines.join('\n');
}

export function formatE2eRunMarkdown(summary: E2eRunSummary): string {
  const terminalReport = formatE2eRunSummary(summary).trim().replace(/```/g, '` ` `');
  return [
    '# Relatório E2E',
    '',
    '> Gerado localmente pelo Playwright. Este arquivo é substituído pela execução E2E mais recente.',
    '',
    '```text',
    terminalReport,
    '```',
    '',
  ].join('\n');
}

function localPath(file: string): string {
  const projectRelative = relative(process.cwd(), file);
  return projectRelative.startsWith('..') ? file : projectRelative;
}

function testTitle(test: TestCase): string {
  const titlePath = test.titlePath();
  const behaviorPath = titlePath.length > 3 ? titlePath.slice(3) : titlePath.filter(Boolean);
  return behaviorPath.join(' > ') || test.title;
}

function projectName(test: TestCase): string {
  return test.parent.project()?.name || 'projeto não identificado';
}

function errorMessage(error: TestError | undefined): string {
  return error?.message || error?.stack || error?.value || 'O Playwright não informou a causa.';
}

function skipReason(test: TestCase): string | undefined {
  return test.annotations.find((annotation) =>
    ['skip', 'fixme'].includes(annotation.type.toLowerCase()),
  )?.description;
}

export default class DevE2eSummaryReporter implements Reporter {
  private tests: TestCase[] = [];
  private readonly externalErrors: string[] = [];
  private readonly outputFile: string;
  private readonly htmlPath: string;
  private readonly slowTestMs: number;
  private readonly write: (text: string) => void;
  private readonly writeMarkdown: (path: string, text: string) => void;

  constructor(options: DevE2eSummaryReporterOptions = {}) {
    this.outputFile = options.outputFile ?? DEFAULT_OUTPUT_FILE;
    this.htmlPath = options.htmlPath ?? DEFAULT_HTML_FILE;
    this.slowTestMs = options.slowTestMs ?? DEFAULT_SLOW_TEST_MS;
    this.write = options.write ?? ((text) => writeSync(process.stdout.fd, text));
    this.writeMarkdown =
      options.writeMarkdown ??
      ((path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, 'utf8');
      });
  }

  printsToStdio(): boolean {
    return true;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.tests = suite.allTests();
  }

  onError(error: TestError): void {
    this.externalErrors.push(errorMessage(error));
  }

  onEnd(result: FullResult): void {
    // `playwright --list` descobre casos, mas não cria nenhuma tentativa.
    // Não trate essa operação de consulta como uma suíte totalmente ignorada.
    if (this.tests.length > 0 && this.tests.every((test) => test.results.length === 0)) return;

    const summary = this.buildSummary(result);
    let output = formatE2eRunSummary(summary);

    try {
      this.writeMarkdown(this.outputFile, formatE2eRunMarkdown(summary));
    } catch (error) {
      summary.externalErrors.push(
        `Não foi possível gravar o relatório Markdown em ${this.outputFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
      output = formatE2eRunSummary(summary);
    }

    this.write(output);
  }

  private buildSummary(result: FullResult): E2eRunSummary {
    const summary: E2eRunSummary = {
      status: result.status,
      durationMs: result.duration,
      total: this.tests.length,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      interrupted: 0,
      slow: [],
      failures: [],
      flakyTests: [],
      skippedTests: [],
      externalErrors: [...this.externalErrors],
      markdownPath: this.outputFile,
      htmlPath: this.htmlPath,
    };

    for (const test of this.tests) {
      const outcome = test.outcome();
      const title = testTitle(test);
      const project = projectName(test);
      const lastResult = test.results.at(-1);

      if (outcome === 'unexpected') {
        summary.failed += 1;
        const error = lastResult?.errors[0];
        const location = error?.location ?? test.location;
        summary.failures.push({
          title,
          projectName: project,
          file: localPath(location.file),
          line: location.line,
          column: location.column,
          durationMs: lastResult?.duration ?? 0,
          retry: lastResult?.retry ?? 0,
          message: errorMessage(error),
          snippet: error?.snippet,
          attachments: (lastResult?.attachments ?? [])
            .filter((attachment) => attachment.path)
            .map((attachment) => ({
              name: attachment.name,
              path: localPath(attachment.path as string),
            })),
        });
      } else if (outcome === 'flaky') {
        summary.flaky += 1;
        summary.flakyTests.push({
          title,
          projectName: project,
          retries: lastResult?.retry ?? Math.max(test.results.length - 1, 1),
        });
      } else if (outcome === 'skipped') {
        summary.skipped += 1;
        summary.skippedTests.push({ title, projectName: project, reason: skipReason(test) });
      } else {
        summary.passed += 1;
      }

      if (lastResult?.status === 'interrupted') summary.interrupted += 1;
      if (lastResult && lastResult.duration >= this.slowTestMs) {
        summary.slow.push({
          title,
          projectName: project,
          durationMs: lastResult.duration,
          file: localPath(test.location.file),
          line: test.location.line,
        });
      }
    }

    return summary;
  }
}
