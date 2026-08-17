# Insecure HTTP Test Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o artefato temporário executado em `http://<ip>:4000` grave e sincronize comandos online sem configurar cada navegador, preservando o comportamento seguro do build normal.

**Architecture:** Uma constante substituída pelo Angular diferencia o build normal do build `http-test`. Os serviços continuam preferindo Web Crypto; somente no build temporário usam `crypto.getRandomValues()` para UUID v4 e `js-sha256` para o hash. O mesmo sinalizador desabilita o Service Worker, e o `.bat` seleciona explicitamente o artefato temporário.

**Tech Stack:** Angular 21, TypeScript 5.9, Vitest, Web Crypto, `js-sha256`, Angular file replacements, Windows Batch.

## Global Constraints

- O modo temporário funciona somente online e não oferece instalação/atualização PWA.
- `Math.random()` não pode ser usado para identidade.
- O build normal deve manter o comportamento atual e falhar sem Web Crypto.
- O fallback deve produzir UUID v4 válido e SHA-256 hexadecimal com 64 caracteres.
- O `.env` permanece exclusivo do servidor e nenhuma credencial vai para o bundle.
- O `.bat` deve explicar em comentários como restaurar `npm run build` quando HTTPS estiver disponível.

---

### Task 1: Sinalizador isolado e configuração do build HTTP

**Files:**
- Create: `src/app/core/runtime/insecure-http-test-mode.ts`
- Create: `src/app/core/runtime/insecure-http-test-mode.http-test.ts`
- Modify: `angular.json`
- Modify: `package.json`
- Modify: `src/app/core/offline/pwa/pwa-assets.spec.ts`

**Interfaces:**
- Produces: `INSECURE_HTTP_TEST_MODE: boolean`, importável pelo runtime.
- Produces: comando `npm run build:http-test`.

- [ ] **Step 1: Write the failing configuration test**

Acrescentar ao teste de artefatos PWA verificações de que existe a configuração `http-test`, ela não declara `serviceWorker`, substitui o arquivo de modo e que `package.json` expõe `build:http-test`:

```ts
expect(packageJson.scripts['build:http-test'])
  .toBe('ng build --configuration http-test');
expect(configurations['http-test'].serviceWorker).toBeUndefined();
expect(configurations['http-test'].fileReplacements).toContainEqual({
  replace: 'src/app/core/runtime/insecure-http-test-mode.ts',
  with: 'src/app/core/runtime/insecure-http-test-mode.http-test.ts',
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/app/core/offline/pwa/pwa-assets.spec.ts`

Expected: FAIL porque `build:http-test` e `configurations.http-test` ainda não existem.

- [ ] **Step 3: Add the two build constants**

Criar o arquivo normal:

```ts
export const INSECURE_HTTP_TEST_MODE = false;
```

Criar o arquivo substituto:

```ts
// Este valor só entra no artefato temporário criado por build:http-test.
export const INSECURE_HTTP_TEST_MODE = true;
```

- [ ] **Step 4: Add Angular and npm configuration**

Adicionar a `angular.json`:

```json
"http-test": {
  "optimization": true,
  "extractLicenses": true,
  "outputHashing": "all",
  "fileReplacements": [
    {
      "replace": "src/app/core/runtime/insecure-http-test-mode.ts",
      "with": "src/app/core/runtime/insecure-http-test-mode.http-test.ts"
    }
  ]
}
```

Adicionar a `package.json`:

```json
"build:http-test": "ng build --configuration http-test"
```

- [ ] **Step 5: Run the focused test**

Run: `npm test -- --run src/app/core/offline/pwa/pwa-assets.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit the build configuration**

```bash
git add angular.json package.json src/app/core/runtime src/app/core/offline/pwa/pwa-assets.spec.ts
git commit -m "build: add temporary insecure HTTP configuration"
```

---

### Task 2: UUID v4 seguro no modo HTTP temporário

**Files:**
- Modify: `src/app/core/offline/services/idempotency.service.ts`
- Modify: `src/app/core/offline/services/idempotency.service.spec.ts`

**Interfaces:**
- Consumes: `INSECURE_HTTP_TEST_MODE: boolean`.
- Produces: `provideBrowserRandomUuid(allowInsecureFallback?: boolean, candidate?: Crypto): RandomUuidCapability | undefined`.
- Produces: `uuidV4FromRandomValues(crypto: Pick<Crypto, 'getRandomValues'>): string`.

- [ ] **Step 1: Write failing UUID fallback tests**

Adicionar testes que forneçam 16 bytes previsíveis, comprovem a máscara de versão/variante e confirmem que o fallback continua desligado por padrão:

```ts
it('gera UUID v4 por getRandomValues apenas no modo HTTP temporário', () => {
  const candidate = {
    getRandomValues: vi.fn((bytes: Uint8Array) => {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return bytes;
    }),
  } as unknown as Crypto;

  const capability = provideBrowserRandomUuid(true, candidate);

  expect(capability?.randomUUID()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
});

it('não habilita fallback inseguro no build normal', () => {
  const candidate = { getRandomValues: vi.fn() } as unknown as Crypto;
  expect(provideBrowserRandomUuid(false, candidate)).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/app/core/offline/services/idempotency.service.spec.ts`

Expected: FAIL porque o provider ainda não recebe o modo nem implementa o UUID alternativo.

- [ ] **Step 3: Implement the minimal UUID fallback**

Importar o sinalizador. Preservar `randomUUID()` como primeira escolha; apenas quando ele estiver ausente, o modo estiver ativo e `getRandomValues()` existir, criar 16 bytes, aplicar `bytes[6] = (bytes[6] & 0x0f) | 0x40` e `bytes[8] = (bytes[8] & 0x3f) | 0x80`, converter para hexadecimal e inserir os separadores do UUID.

```ts
export function provideBrowserRandomUuid(
  allowInsecureFallback = INSECURE_HTTP_TEST_MODE,
  candidate = globalThis.crypto,
): RandomUuidCapability | undefined {
  if (typeof globalThis.window === 'undefined') return undefined;
  if (typeof candidate?.randomUUID === 'function') return candidate;
  if (!allowInsecureFallback || typeof candidate?.getRandomValues !== 'function') return undefined;
  return { randomUUID: () => uuidV4FromRandomValues(candidate) };
}
```

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --run src/app/core/offline/services/idempotency.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit UUID fallback**

```bash
git add src/app/core/offline/services/idempotency.service.ts src/app/core/offline/services/idempotency.service.spec.ts
git commit -m "feat: generate command UUIDs in HTTP test build"
```

---

### Task 3: SHA-256 em software e Service Worker desabilitado

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/app/core/offline/services/payload-integrity.service.ts`
- Modify: `src/app/core/offline/services/payload-integrity.service.spec.ts`
- Modify: `src/app/app.config.ts`
- Modify: `src/app/core/offline/pwa/pwa-assets.spec.ts`

**Interfaces:**
- Consumes: `INSECURE_HTTP_TEST_MODE: boolean`.
- Consumes: `sha256(input: string): string` de `js-sha256`.
- Produces: `SOFTWARE_SHA256_PROVIDER`, que entrega o fallback somente no build temporário.

- [ ] **Step 1: Install the browser SHA-256 implementation**

Run: `npm install js-sha256@0.11.1`

Expected: `package.json` e `package-lock.json` passam a registrar exatamente `js-sha256` 0.11.1 ou resolução compatível com essa versão.

- [ ] **Step 2: Write failing fallback and PWA tests**

Adicionar:

```ts
it('usa SHA-256 em software somente no modo HTTP temporário', async () => {
  const fallback = new PayloadIntegrityService(() => undefined, () => sha256);
  await expect(fallback.hashCanonical('abc')).resolves.toBe(SHA_256_ABC);
});

it('preserva erro sem Web Crypto no modo normal', async () => {
  const unavailable = new PayloadIntegrityService(() => undefined, () => undefined);
  await expect(unavailable.hashCanonical('abc')).rejects.toEqual(
    expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
  );
});
```

No teste de PWA, verificar que `app.config.ts` condiciona o provider ao sinalizador:

```ts
expect(appConfigSource).toContain('!INSECURE_HTTP_TEST_MODE');
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- --run src/app/core/offline/services/payload-integrity.service.spec.ts src/app/core/offline/pwa/pwa-assets.spec.ts`

Expected: FAIL porque o construtor não aceita o sinalizador e o Service Worker ainda ignora o modo.

- [ ] **Step 4: Implement SHA-256 fallback and disable PWA**

No serviço, manter Web Crypto como primeira escolha. Criar um provider que só
expõe `sha256` quando a constante do build estiver ativa. Fora dele, preservar
`CAPABILITY_UNAVAILABLE`. O parâmetro de construtor deve continuar opcional
para não quebrar instanciações manuais:

```ts
export type SoftwareSha256Provider = () => typeof sha256 | undefined;

export const SOFTWARE_SHA256_PROVIDER = new InjectionToken<SoftwareSha256Provider>(
  'OFFLINE_SOFTWARE_SHA256_PROVIDER',
  {
    providedIn: 'root',
    factory: () => () => INSECURE_HTTP_TEST_MODE ? sha256 : undefined,
  },
);

constructor(
  @Inject(SUBTLE_CRYPTO_PROVIDER) private readonly provideSubtle: SubtleCryptoProvider,
  @Inject(SOFTWARE_SHA256_PROVIDER)
  private readonly provideSoftwareSha256: SoftwareSha256Provider = () => undefined,
) {}
```

No provider do Service Worker:

```ts
enabled: !isDevMode() && !INSECURE_HTTP_TEST_MODE,
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/app/core/offline/services/payload-integrity.service.spec.ts src/app/core/offline/pwa/pwa-assets.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit integrity fallback**

```bash
git add package.json package-lock.json src/app/app.config.ts src/app/core/offline/services/payload-integrity.service.ts src/app/core/offline/services/payload-integrity.service.spec.ts src/app/core/offline/pwa/pwa-assets.spec.ts
git commit -m "feat: hash commands in HTTP test build"
```

---

### Task 4: Recuperar a tela de resultado após erro síncrono

**Files:**
- Modify: `src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.ts`
- Modify: `src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.spec.ts`

**Interfaces:**
- Consumes: `IdempotencyService.resolve(): string`.
- Produces: `saveCurrentMeasurement()` retornando `of(null)` e liberando `isSaving` quando a geração de identidade falha.

- [ ] **Step 1: Write the failing component test**

Fornecer um mock controlável de `IdempotencyService` no TestBed e adicionar:

```ts
it('libera o formulário quando a identidade não pode ser gerada', async () => {
  idempotency.resolve.mockImplementationOnce(() => {
    throw new Error('identity-unavailable');
  });
  component.updateResult('24');

  await expect(firstValueFrom(component.saveCurrentMeasurement())).resolves.toBeNull();

  expect(state.isSaving()).toBe(false);
  expect(state.examFeedback()).toContain('identidade segura');
  expect(capture).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.spec.ts`

Expected: FAIL porque a exceção escapa de `saveCurrentMeasurement()` e `isSaving` permanece verdadeiro.

- [ ] **Step 3: Handle the synchronous error at its boundary**

Envolver apenas `ensureMeasurementCommandId(...)` em `try/catch`. No `catch`, definir `isSaving` como falso, exibir `Não foi possível gerar a identidade segura do resultado.` e retornar `of(null)`. Não esconder erros posteriores de captura/sincronização.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --run src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit UI recovery**

```bash
git add src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.ts src/app/features/quality-control/components/exam-entry-panel/exam-entry-panel.spec.ts
git commit -m "fix: release quality form after identity failure"
```

---

### Task 5: Atualizador Windows e verificação integrada

**Files:**
- Modify: `atualiza-front.bat`

**Interfaces:**
- Consumes: `npm run build:http-test`.
- Produces: atualização Windows que gera o artefato temporário e documenta a reversão.

- [ ] **Step 1: Update the batch build command with rollback comments**

Substituir somente a etapa de build por:

```bat
REM MODO TEMPORARIO DE TESTE VIA HTTP/IP:
REM Este build habilita fallbacks somente para o ambiente interno sem HTTPS.
REM Quando o servidor receber HTTPS, troque a linha abaixo por: call npm run build
call npm run build:http-test
```

- [ ] **Step 2: Run static checks and the full unit suite**

Run: `git diff --check`

Expected: saída vazia e código zero.

Run: `npm test -- --run`

Expected: todos os testes passam.

- [ ] **Step 3: Build both artifacts**

Run: `npm run build:http-test`

Expected: build completo sem `ngsw-worker.js`/`ngsw.json` no artefato HTTP.

Run: `npm run build`

Expected: build de produção completo com os artefatos PWA preservados.

- [ ] **Step 4: Inspect generated behavior**

Buscar no bundle HTTP a mensagem de fallback/flag e confirmar ausência do manifesto NGSW. Buscar no bundle normal a mensagem de capacidade e confirmar presença de `ngsw.json`. Não iniciar ou alterar o servidor externo.

- [ ] **Step 5: Commit the updater and any final test adjustments**

```bash
git add atualiza-front.bat
git commit -m "build: deploy temporary HTTP test artifact"
```

- [ ] **Step 6: Record manual acceptance steps**

Após `atualiza-front.bat` ser executado no servidor Windows, abrir `http://10.101.195.236:4000`, confirmar `window.isSecureContext === false`, salvar um resultado e finalizar um roteiro. Verificar no Network e na Central de Sincronização que os dois comandos foram enviados ao Datasul.
