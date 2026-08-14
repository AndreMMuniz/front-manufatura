# System, API, and Browser Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar eventos do servidor, APIs e navegador no terminal e em arquivos locais rotacionados, com correlação e sanitização de dados sensíveis.

**Architecture:** Um logger Winston server-only fornece console e rotação diária JSONL. Middlewares Express adicionam correlação e recebem eventos frontend allowlisted; no Angular, um serviço best-effort, um `ErrorHandler` e um interceptor enviam apenas falhas relevantes sem criar recursão.

**Tech Stack:** Node.js 20+, Express 5, Angular 21, TypeScript 5.9, Vitest, Winston 3, winston-daily-rotate-file 5.

## Global Constraints

- Console legível e arquivos JSON Lines em `APP_LOG_DIR`.
- Defaults exatos: `APP_LOG_LEVEL=info`, `APP_LOG_DIR=logs`, retenção de 14 dias e tamanho máximo de 20 MB.
- Arquivos nomeados `app-YYYY-MM-DD.log`, com sufixo quando houver rotação por tamanho.
- Nunca registrar query strings, headers completos, bodies, resultados de medição, senhas, tokens, cookies ou `Authorization`.
- Mensagens frontend limitadas a 1.000 caracteres, stacks a 4.000 e body do endpoint a 16 KB.
- Endpoint frontend limitado a 60 eventos por minuto por IP.
- O logger é best-effort: falha de console, disco ou rede nunca pode derrubar API ou frontend.
- O endpoint de logs e o interceptor devem evitar recursão.
- Nenhuma fila offline, painel, envio remoto, compactação ou busca full-text.

---

### Task 1: Configuração, sanitização e logger rotacionado

**Files:**
- Create: `src/observability/log-config.ts`
- Create: `src/observability/log-sanitizer.ts`
- Create: `src/observability/app-logger.ts`
- Create: `src/observability/app-logger.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `LogConfig`, `readLogConfig(env, cwd?)`, `sanitizeLogValue(value)`.
- Produces: `AppLogger` com `info`, `warn` e `error` best-effort.
- Produces: `createAppLogger(config, dependencies?)` para produção e testes.

- [ ] **Step 1: Install server logging dependencies**

Run: `npm install winston@3 winston-daily-rotate-file@5`

Expected: dependências registradas em `package.json` e versões resolvidas em `package-lock.json`.

- [ ] **Step 2: Write failing config and sanitizer tests**

Criar testes com os contratos abaixo:

```ts
expect(readLogConfig({}, '/srv/app')).toEqual({
  level: 'info',
  directory: '/srv/app/logs',
  retentionDays: 14,
  maxSize: '20m',
});

expect(readLogConfig({
  APP_LOG_LEVEL: 'invalid',
  APP_LOG_RETENTION_DAYS: '-1',
  APP_LOG_MAX_SIZE: 'huge',
}, '/srv/app')).toEqual(expect.objectContaining({
  level: 'info', retentionDays: 14, maxSize: '20m',
}));

expect(sanitizeLogValue({
  authorization: 'Bearer secret',
  nested: { senha: '123', safe: 'linha\nforjada' },
})).toEqual({
  authorization: '[REDACTED]',
  nested: { senha: '[REDACTED]', safe: 'linha forjada' },
});
```

Também testar truncamento de mensagem/stack, ciclos, profundidade máxima e `Error` reduzido a `name`, `message` e `stack` sanitizados.

- [ ] **Step 3: Run tests and verify RED**

Run: `npm test -- --watch=false --include src/observability/app-logger.spec.ts`

Expected: FAIL porque os módulos ainda não existem.

- [ ] **Step 4: Implement config and sanitizer**

Definir:

```ts
export interface LogConfig {
  readonly level: 'error' | 'warn' | 'info' | 'debug';
  readonly directory: string;
  readonly retentionDays: number;
  readonly maxSize: `${number}m`;
}

export function readLogConfig(
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): LogConfig;

export function sanitizeLogValue(value: unknown): unknown;
```

Resolver caminho relativo contra `cwd`. Aceitar retenção inteira entre 1 e 365 e tamanho `/^[1-9]\d{0,3}m$/`; demais valores usam defaults. Sanitizar recursivamente até profundidade 6 e até 50 chaves/itens por nível. Normalizar `\r`/`\n` para espaço e substituir chaves sensíveis por `[REDACTED]`.

- [ ] **Step 5: Implement the best-effort logger**

Definir:

```ts
export interface AppLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}
```

`createAppLogger` deve criar `Console` com formato compacto e `DailyRotateFile` com `filename: 'app-%DATE%.log'`, `datePattern: 'YYYY-MM-DD'`, `maxFiles: '${retentionDays}d'`, `maxSize`, JSON e pasta configurada. Cada método sanitiza campos e envolve `logger.log` em `try/catch`. Tratar evento `error` dos transports sem lançar para o chamador.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm test -- --watch=false --include src/observability/app-logger.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit logger core**

```bash
git add package.json package-lock.json src/observability
git commit -m "feat: add rotating sanitized application logger"
```

---

### Task 2: Correlação HTTP e endpoint de eventos frontend

**Files:**
- Create: `src/observability/http-request-logging.ts`
- Create: `src/observability/client-log-endpoint.ts`
- Create: `src/observability/http-observability.spec.ts`

**Interfaces:**
- Consumes: `AppLogger` da Task 1.
- Produces: `requestLoggingMiddleware(logger, now?)`.
- Produces: `installClientLogEndpoint(app, { logger, now?, limit? })`.
- Produces: `ClientLogEvent` server-side validado.

- [ ] **Step 1: Write failing middleware tests**

Criar um Express de teste com logger gravador. Cobrir:

```ts
expect(response.headers.get('x-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
expect(recorded).toContainEqual(expect.objectContaining({
  event: 'http.request.completed',
  fields: expect.objectContaining({ method: 'GET', path: '/api/test', status: 204 }),
}));
expect(JSON.stringify(recorded)).not.toContain('segredo=query');
```

Enviar `X-Correlation-Id: corr-123` e confirmar preservação; enviar valor com quebra de linha/caracteres inválidos e confirmar UUID novo. Simular `close` antes de `finish` para `http.request.aborted` sem duplicar conclusão.

- [ ] **Step 2: Write failing endpoint tests**

Cobrir evento válido, campo extra, level/event inválido, data inválida, body acima de 16 KB e a 61ª chamada no mesmo minuto:

```ts
expect(valid.status).toBe(204);
expect(invalid.status).toBe(400);
expect(oversized.status).toBe(413);
expect(rateLimited.status).toBe(429);
expect(logger.events.at(-1)).toMatchObject({
  event: 'client.error',
  fields: { clientEvent: 'window.error', message: 'falha', route: '/quality-control' },
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `npm test -- --watch=false --include src/observability/http-observability.spec.ts`

Expected: FAIL porque middlewares não existem.

- [ ] **Step 4: Implement request correlation**

Aceitar header recebido somente se `/^[A-Za-z0-9._:-]{1,128}$/`. Caso contrário usar `node:crypto.randomUUID()`. Definir o header de resposta e registrar somente `new URL(req.originalUrl, 'http://local').pathname`, método, status e `durationMs`. Não registrar estáticos em `info`; permitir APIs, `/api/health` e respostas com status `>= 400`.

- [ ] **Step 5: Implement the client-log endpoint**

Usar parser exclusivo:

```ts
app.post(
  '/api/client-logs',
  express.json({ limit: '16kb', strict: true }),
  handler,
);
```

Validar exatamente as chaves de `ClientLogEvent`, limites de texto e allowlists. Criar rate limiter em memória com `Map<string, { windowStartedAt: number; count: number }>`; expirar entradas após dois minutos e limitar o mapa a 1.000 IPs removendo os mais antigos. Responder `204`, `400`, `413` ou `429`, sem ecoar body/erro bruto.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm test -- --watch=false --include src/observability/http-observability.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit HTTP observability**

```bash
git add src/observability/http-request-logging.ts src/observability/client-log-endpoint.ts src/observability/http-observability.spec.ts
git commit -m "feat: log correlated API and browser events"
```

---

### Task 3: Integrar logger ao servidor e ao atualizador Windows

**Files:**
- Modify: `src/server.ts`
- Create: `src/observability/server-lifecycle.ts`
- Create: `src/observability/server-lifecycle.spec.ts`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `atualiza-front.bat`

**Interfaces:**
- Consumes: config/logger/middlewares das Tasks 1-2.
- Produces: `installProcessLogging(processLike, logger): () => void`.

- [ ] **Step 1: Write failing lifecycle and static configuration tests**

Testar um `EventEmitter` que simula process:

```ts
const cleanup = installProcessLogging(fakeProcess, logger);
fakeProcess.emit('unhandledRejection', new Error('Bearer segredo'));
expect(logger.events).toContainEqual(expect.objectContaining({
  event: 'system.unhandled_rejection',
}));
cleanup();
expect(fakeProcess.listenerCount('unhandledRejection')).toBe(0);
```

Adicionar teste estático confirmando `logs/` no `.gitignore`, as quatro variáveis em `.env.example` e os comentários/echo no `.bat` sem remover os comentários de reversão do build HTTP.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --watch=false --include src/observability/server-lifecycle.spec.ts`

Expected: FAIL porque integração ainda não existe.

- [ ] **Step 3: Implement process lifecycle logging**

Registrar `uncaughtExceptionMonitor`, `unhandledRejection`, `SIGINT` e `SIGTERM`. O logger sanitiza erros; os listeners não devem chamar `process.exit`, alterar `exitCode` nem impedir o comportamento nativo. Retornar cleanup que remove exatamente os listeners instalados.

- [ ] **Step 4: Wire middleware and startup into server.ts**

Ordem obrigatória:

```ts
const logConfig = readLogConfig(process.env);
const logger = createAppLogger(logConfig);
app.use(requestLoggingMiddleware(logger));
installClientLogEndpoint(app, { logger });
installAuthLoginEndpoint(app, { env: process.env });
installQualityControlEndpoints(app, { env: process.env });
installFmaEndpoints(app, { env: process.env });
```

No callback de `listen`, emitir `system.start` com `port`, `environment` e `logDirectory`, além da mensagem legível do terminal. Instalar lifecycle apenas quando o módulo for executável/PM2, não durante import SSR/teste.

- [ ] **Step 5: Document env, ignore logs, and update BAT**

Adicionar `.env.example` com os quatro valores exatos. Adicionar `/logs/` ao `.gitignore`. Antes do comando Node no `.bat`:

```bat
echo Logs do sistema: %CD%\logs por padrao
echo Para outro caminho, configure APP_LOG_DIR no arquivo .env
```

Como `node --env-file=.env` não carrega variáveis no processo Batch, o texto deve esclarecer que `logs` é o default e que um caminho customizado pode estar definido dentro de `.env`; não fingir que o Batch leu `.env`.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm test -- --watch=false --include src/observability/server-lifecycle.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit server integration**

```bash
git add src/server.ts src/observability/server-lifecycle.ts src/observability/server-lifecycle.spec.ts .env.example .gitignore atualiza-front.bat
git commit -m "feat: enable local server logging"
```

---

### Task 4: Captura best-effort no Angular

**Files:**
- Create: `src/app/core/logging/client-log.model.ts`
- Create: `src/app/core/logging/client-logging.service.ts`
- Create: `src/app/core/logging/client-logging.service.spec.ts`
- Create: `src/app/core/logging/client-logging.interceptor.ts`
- Create: `src/app/core/logging/client-logging.interceptor.spec.ts`
- Create: `src/app/core/logging/browser-logging-error-handler.ts`
- Modify: `src/app/app.config.ts`
- Modify: `src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.ts`
- Modify: `src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.spec.ts`

**Interfaces:**
- Produces: `ClientLogEvent` idêntico ao schema server-side.
- Produces: `ClientLoggingService.start()`, `.log()`, `.capabilityUnavailable()` e `.httpFailure()`.
- Produces: `clientLoggingInterceptor` e `BrowserLoggingErrorHandler`.

- [ ] **Step 1: Write failing service tests**

Injetar `CLIENT_LOG_FETCH` falso e testar:

```ts
service.log({ level: 'error', event: 'window.error', message: 'falha' });
expect(fetchMock).toHaveBeenCalledWith('/api/client-logs', expect.objectContaining({
  method: 'POST', keepalive: true,
}));
```

Confirmar rota sem query, truncamento de mensagem/stack, ISO em `occurredAt`, ausência de throw quando fetch rejeita e listeners removidos por cleanup. Disparar eventos `error` e `unhandledrejection` para validar `window.error` e `promise.rejection`.

- [ ] **Step 2: Write failing interceptor and component tests**

Confirmar que um `HttpErrorResponse` gera `http.failure`, preserva o erro original para o consumidor e que `/api/client-logs` nunca chama o logger. No `ExamEntryPanel`, confirmar que a falha síncrona de UUID chama `capabilityUnavailable('randomUUID', message)` antes de liberar o formulário.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test -- --watch=false \
  --include src/app/core/logging/client-logging.service.spec.ts \
  --include src/app/core/logging/client-logging.interceptor.spec.ts \
  --include src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.spec.ts
```

Expected: FAIL porque serviços/providers ainda não existem.

- [ ] **Step 4: Implement client logging service**

Criar `CLIENT_LOG_FETCH` e `CLIENT_LOG_WINDOW` como tokens para teste/SSR. `log()` deve montar apenas campos allowlisted, limitar textos, remover query da rota e executar:

```ts
void fetch('/api/client-logs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(event),
  keepalive: true,
  credentials: 'same-origin',
}).catch(() => undefined);
```

`start()` instala `error` e `unhandledrejection` somente no browser e retorna cleanup idempotente. Aplicar deduplicação de fingerprints idênticos por cinco segundos com mapa limitado a 100 entradas.

- [ ] **Step 5: Implement ErrorHandler and interceptor**

`BrowserLoggingErrorHandler.handleError(error)` envia `angular.error` e ainda executa `console.error` somente com nome e mensagem sanitizados, nunca com o objeto bruto. O interceptor usa `catchError`, ignora `/api/client-logs`, chama `httpFailure` e retorna `throwError(() => error)`.

- [ ] **Step 6: Register providers and capability event**

Em `app.config.ts`, usar:

```ts
provideHttpClient(
  withFetch(),
  withInterceptors([clientLoggingInterceptor]),
  withInterceptorsFromDi(),
),
{ provide: ErrorHandler, useClass: BrowserLoggingErrorHandler },
```

No initializer browser existente, chamar `clientLogging.start()`. No catch de identidade em `ExamEntryPanel`, chamar `capabilityUnavailable` sem incluir resultado, observação ou operador.

- [ ] **Step 7: Run focused tests and verify GREEN**

Executar o comando do Step 3.

Expected: PASS.

- [ ] **Step 8: Commit browser logging**

```bash
git add src/app/core/logging src/app/app.config.ts src/app/features/quality-control/components/exam-entry-panel
git commit -m "feat: report sanitized browser failures"
```

---

### Task 5: Verificação integrada e documentação operacional

**Files:**
- Create: `docs/atualiza-front-logs.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: todos os componentes anteriores.
- Produces: runbook de localização, leitura, coleta e limpeza dos logs.

- [ ] **Step 1: Write the operational runbook**

Documentar comandos Windows sem apagar arquivos automaticamente:

```bat
dir logs
type logs\app-AAAA-MM-DD.log
findstr /I "client.error http.request.completed correlationId" logs\app-AAAA-MM-DD.log
```

Explicar formato JSONL, variáveis `.env`, retenção, redaction, `X-Correlation-Id`, aviso para não enviar arquivos publicamente sem revisão e roteiro de aceitação manual.

- [ ] **Step 2: Link the runbook from README**

Adicionar uma seção curta “Logs locais de diagnóstico” com link relativo para `docs/atualiza-front-logs.md`.

- [ ] **Step 3: Run static and full verification**

Run: `git diff --check`

Expected: saída vazia.

Run: `npm test -- --watch=false`

Expected: todos os testes passam; testes Express podem exigir permissão para sockets locais.

Run: `npm run build:http-test`

Expected: build temporário passa.

Run: `npm run build`

Expected: build normal passa.

- [ ] **Step 4: Run a local smoke test**

Iniciar o servidor construído com variáveis de teste, chamar `/api/health` e `/api/client-logs`, encerrar o servidor e confirmar:

- terminal contém `system.start` e `http.request.completed`;
- `logs/app-<data>.log` existe e contém JSON válido por linha;
- segredo sintético enviado em campo proibido não aparece no arquivo;
- resposta contém `X-Correlation-Id`.

- [ ] **Step 5: Commit documentation and final adjustments**

```bash
git add docs/atualiza-front-logs.md README.md
git commit -m "docs: add local logging runbook"
```

- [ ] **Step 6: Record manual Windows acceptance**

Após publicar, executar `atualiza-front.bat`, abrir o sistema por IP, provocar uma rota inexistente e um erro frontend controlado, salvar um resultado e confirmar correlação no terminal/arquivo sem credenciais ou payloads sensíveis.
