import { writeSync } from 'node:fs';

import type { TestModule } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';

type RunEndReason = Parameters<NonNullable<Reporter['onTestRunEnd']>>[2];
type SerializedError = Parameters<NonNullable<Reporter['onTestRunEnd']>>[1][number];

export interface TestFailureSummary {
  name: string;
  file: string;
  line?: number;
  column?: number;
  durationMs?: number;
  messages: string[];
}

export interface TestRunSummary {
  reason: RunEndReason;
  durationMs: number;
  files: {
    passed: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  tests: {
    passed: number;
    failed: number;
    skipped: number;
    todo: number;
    pending: number;
  };
  failures: TestFailureSummary[];
  externalErrors: string[];
  coverageFailed: boolean;
  exitCodeFailed: boolean;
  coverageHtmlPath: string;
}

export interface ReporterRuntime {
  getExitCode(): string | number | undefined;
  onExit(listener: (code: number) => void): void;
  offExit(listener: (code: number) => void): void;
}

export type SummaryWriter = (text: string) => void;

export interface DevTestSummaryReporterOptions {
  write?: SummaryWriter;
  runtime?: ReporterRuntime;
}

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

const processRuntime: ReporterRuntime = {
  getExitCode: () => process.exitCode,
  onExit: (listener) => process.on('exit', listener),
  offExit: (listener) => process.off('exit', listener),
};

function isFailureExitCode(exitCode: string | number | undefined): boolean {
  return exitCode !== undefined && Number(exitCode) !== 0;
}

function normalizeMessage(error: SerializedError): string {
  const message = error.message?.trim() || error.stack?.trim();
  return (message || 'Erro sem mensagem disponível.').replace(ANSI_PATTERN, '').trim();
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'duração indisponível';
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(2)} s`;
}

function formatLocation(failure: TestFailureSummary): string {
  if (failure.line === undefined) return failure.file;
  return `${failure.file}:${failure.line}${failure.column !== undefined ? `:${failure.column}` : ''}`;
}

function indentMessage(message: string): string {
  return message.replace(/\r?\n/g, '\n          ');
}

export function formatTestRunSummary(summary: TestRunSummary): string {
  const hasPending = summary.tests.pending > 0 || summary.files.pending > 0;
  const executionFailed =
    summary.reason !== 'passed' || summary.externalErrors.length > 0 || summary.exitCodeFailed;
  const succeeded =
    !executionFailed && !hasPending && summary.tests.failed === 0 && !summary.coverageFailed;
  const fileTotal = Object.values(summary.files).reduce((total, value) => total + value, 0);
  const testTotal = Object.values(summary.tests).reduce((total, value) => total + value, 0);
  const ignored = summary.tests.skipped + summary.tests.todo;
  const lines = [
    '',
    '════════════════ RELATÓRIO DE TESTES ════════════════',
    succeeded ? 'RESULTADO GERAL: APROVADO ✓' : 'RESULTADO GERAL: REPROVADO ✗',
    '',
    `Arquivos: ${summary.files.passed} aprovados | ${summary.files.failed} com falha | ${summary.files.skipped} ignorados | ${fileTotal} no total`,
    `Testes:   ${summary.tests.passed} aprovados | ${summary.tests.failed} com falha | ${ignored} ignorados | ${testTotal} no total`,
  ];

  if (summary.tests.todo > 0) {
    lines.push(`           ↳ ${summary.tests.todo} marcados como TODO`);
  }
  if (hasPending) {
    lines.push(
      `Atenção: ${summary.tests.pending} testes e ${summary.files.pending} arquivos não concluíram.`,
    );
  }

  lines.push(`Duração: ${formatDuration(summary.durationMs)}`);

  if (summary.failures.length > 0) {
    lines.push('', `FALHAS ENCONTRADAS (${summary.failures.length})`);
    summary.failures.forEach((failure, index) => {
      lines.push('', `${index + 1}. Comportamento: ${failure.name}`);
      lines.push(`   Onde investigar: ${formatLocation(failure)}`);
      if (failure.durationMs !== undefined) {
        lines.push(`   Duração do teste: ${formatDuration(failure.durationMs)}`);
      }
      const messages =
        failure.messages.length > 0 ? failure.messages : ['Causa não informada pelo runner.'];
      messages.forEach((message) => lines.push(`   Causa: ${indentMessage(message)}`));
    });
  }

  if (summary.externalErrors.length > 0 || summary.reason === 'interrupted' || hasPending) {
    lines.push('', 'ERROS FORA DOS TESTES');
    if (summary.reason === 'interrupted') {
      lines.push('- A execução foi interrompida antes de concluir.');
    }
    if (hasPending) {
      lines.push('- A suíte terminou com resultados pendentes e não pode ser considerada aprovada.');
    }
    summary.externalErrors.forEach((message) => lines.push(`- ${message}`));
  }

  if (summary.coverageFailed) {
    lines.push(
      '',
      'COBERTURA: REPROVADA',
      'Consulte as mensagens de cobertura logo acima: a geração falhou ou um limite mínimo não foi atingido.',
      `Cobertura HTML: ${summary.coverageHtmlPath}`,
    );
  } else if (executionFailed || hasPending || summary.tests.failed > 0) {
    lines.push('', 'Cobertura HTML: não gerada porque a execução dos testes falhou.');
  } else {
    lines.push('', `Cobertura HTML: ${summary.coverageHtmlPath}`);
  }

  if (!succeeded) {
    lines.push(
      '',
      'Próximo passo: corrija as falhas indicadas acima e execute novamente `make test-coverage`.',
    );
  }

  lines.push('══════════════════════════════════════════════════════', '');
  return lines.join('\n');
}

function emptySummary(reason: RunEndReason, durationMs: number): TestRunSummary {
  return {
    reason,
    durationMs,
    files: { passed: 0, failed: 0, skipped: 0, pending: 0 },
    tests: { passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0 },
    failures: [],
    externalErrors: [],
    coverageFailed: false,
    exitCodeFailed: false,
    coverageHtmlPath: 'coverage/plano-de-controle/index.html',
  };
}

function collectSummary(
  modules: ReadonlyArray<TestModule>,
  unhandledErrors: ReadonlyArray<SerializedError>,
  reason: RunEndReason,
  durationMs: number,
): TestRunSummary {
  const summary = emptySummary(reason, durationMs);
  summary.externalErrors.push(...unhandledErrors.map(normalizeMessage));

  for (const module of modules) {
    const moduleState = module.state();
    if (moduleState === 'passed') summary.files.passed += 1;
    else if (moduleState === 'failed') summary.files.failed += 1;
    else if (moduleState === 'skipped') summary.files.skipped += 1;
    else summary.files.pending += 1;

    summary.externalErrors.push(...module.errors().map(normalizeMessage));

    for (const test of module.children.allTests()) {
      const result = test.result();
      if (result.state === 'passed') {
        summary.tests.passed += 1;
      } else if (result.state === 'failed') {
        summary.tests.failed += 1;
        summary.failures.push({
          name: test.fullName,
          file: module.relativeModuleId,
          line: test.location?.line,
          column: test.location?.column,
          durationMs: test.diagnostic()?.duration,
          messages: result.errors.map(normalizeMessage),
        });
      } else if (result.state === 'skipped') {
        if (test.options.mode === 'todo') summary.tests.todo += 1;
        else summary.tests.skipped += 1;
      } else {
        summary.tests.pending += 1;
      }
    }
  }

  return summary;
}

export default class DevTestSummaryReporter implements Reporter {
  private startedAt = performance.now();
  private coverageEnabled = false;
  private pendingSummary?: TestRunSummary;
  private exitCodeBeforeCoverage?: string | number;
  private printed = false;
  private readonly exitListener = (code: number): void => this.printExitFallback(code);
  private readonly write: SummaryWriter;
  private readonly runtime: ReporterRuntime;

  constructor(
    optionsOrWrite: DevTestSummaryReporterOptions | SummaryWriter = {},
    injectedRuntime?: ReporterRuntime,
  ) {
    const options = typeof optionsOrWrite === 'function' ? {} : optionsOrWrite;
    this.write =
      typeof optionsOrWrite === 'function'
        ? optionsOrWrite
        : (options.write ?? ((text) => writeSync(process.stdout.fd, text)));
    this.runtime = injectedRuntime ?? options.runtime ?? processRuntime;
    this.runtime.onExit(this.exitListener);
  }

  onInit(vitest: Parameters<NonNullable<Reporter['onInit']>>[0]): void {
    this.coverageEnabled = vitest.config.coverage.enabled;
  }

  onTestRunStart(): void {
    if (this.printed) {
      this.printed = false;
      this.runtime.onExit(this.exitListener);
    }
    this.startedAt = performance.now();
    this.exitCodeBeforeCoverage = this.runtime.getExitCode();
  }

  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
    reason: RunEndReason,
  ): void {
    this.pendingSummary = collectSummary(
      modules,
      unhandledErrors,
      reason,
      performance.now() - this.startedAt,
    );
    this.exitCodeBeforeCoverage = this.runtime.getExitCode();

    const testsFailed = this.pendingSummary.tests.failed > 0;
    const hasPending =
      this.pendingSummary.tests.pending > 0 || this.pendingSummary.files.pending > 0;
    const executionFailed = reason !== 'passed' || this.pendingSummary.externalErrors.length > 0;
    if (!this.coverageEnabled || testsFailed || hasPending || executionFailed) {
      this.pendingSummary.exitCodeFailed = isFailureExitCode(this.runtime.getExitCode());
      this.printPendingSummary();
    }
  }

  onProcessTimeout(): void {
    if (!this.pendingSummary) {
      this.pendingSummary = emptySummary('interrupted', performance.now() - this.startedAt);
    }
    this.pendingSummary.reason = 'interrupted';
    this.pendingSummary.externalErrors.push('O processo de testes excedeu o tempo limite.');
    this.pendingSummary.exitCodeFailed = true;
    this.printPendingSummary();
  }

  // Hook interno chamado pelo Vitest após gerar os artefatos e validar os
  // limites de cobertura. O baseline evita atribuir à cobertura um exit code
  // que já estava não zero antes dessa fase.
  onFinishedReportCoverage(): void {
    if (this.pendingSummary) {
      const finalExitCode = this.runtime.getExitCode();
      this.pendingSummary.coverageFailed =
        !isFailureExitCode(this.exitCodeBeforeCoverage) && isFailureExitCode(finalExitCode);
      this.pendingSummary.exitCodeFailed = isFailureExitCode(finalExitCode);
    }
    this.printPendingSummary();
  }

  private printExitFallback(exitCode: number): void {
    if (this.printed) return;
    if (!this.pendingSummary) {
      this.pendingSummary = emptySummary('failed', performance.now() - this.startedAt);
      this.pendingSummary.externalErrors.push(
        `A execução terminou antes de o Vitest entregar os resultados completos (código ${exitCode}).`,
      );
    } else {
      this.pendingSummary.reason = 'interrupted';
      this.pendingSummary.externalErrors.push(
        'A geração da cobertura terminou antes da confirmação do resultado final.',
      );
    }
    this.pendingSummary.exitCodeFailed = isFailureExitCode(exitCode);
    this.printPendingSummary();
  }

  private printPendingSummary(): void {
    if (!this.pendingSummary || this.printed) return;
    this.printed = true;
    this.runtime.offExit(this.exitListener);
    this.write(formatTestRunSummary(this.pendingSummary));
    this.pendingSummary = undefined;
  }
}
