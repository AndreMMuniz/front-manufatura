# Reporte de Operação com Envio Imediato Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o botão `Salvar reporte` persistir o comando localmente, disparar o POST de `ReporteOrdem` imediatamente, aguardar até 30 segundos pelo resultado e informar ao operador se o Datasul recebeu ou se o reporte ficou pendente.

**Architecture:** O fluxo continua local-first: `OperationalCommandFacade.capture()` grava `localRecords` e `outbox` atomicamente e dispara o coordenador existente. Um serviço pequeno observa o mesmo ciclo por `localId`, lê o estado reconciliado da Outbox e devolve `SYNCED`, `PENDING` ou `ERROR`; a feature usa esse resultado para fechar o drawer e exibir a mensagem correta. O drawer mantém `refugoItens` apenas como formato interno compatível, derivando um único item cuja quantidade é a própria `quantidadeRefugo`.

**Tech Stack:** Angular 21, TypeScript 5.9, RxJS 7.8, PO UI, IndexedDB, Vitest 4, Express/Node gateway.

**Spec:** `docs/superpowers/specs/2026-08-28-reporte-operacao-envio-imediato-design.md`

## Global Constraints

- O POST externo é `POST /api/fma/v1/reporteordem?companyId=<id>&codUsuario=<login>` por meio da rota interna `/api/operations/report`.
- Persistir `REPORT_OPERATION` em IndexedDB/Outbox antes de qualquer tentativa remota; Datasul continua sendo o system of record.
- A espera visual é de 30.000 ms e seu vencimento não cancela o sincronizador.
- `Qtde Retrabalho > 0` não exige motivo; `Qtde Refugo > 0` exige exatamente um `Motivo Refugo`.
- O POST envia `qtdAprovada`, `qtdRetrabalho`, `qtdRefugada` e `codMotivoRefugo`; não envia quantidade específica do motivo.
- Não criar um segundo comando quando o remoto rejeitar o primeiro; correções continuam pelo fluxo de erro/supersessão existente.
- Sucesso HTTP confirma aceitação do Datasul, não comprova individualmente como cada campo foi persistido porque a API não fornece leitura/eco documentado.
- Não implementar compactação neste plano; ela está isolada em `docs/superpowers/plans/2026-08-28-retencao-outbox-operacoes.md`.

---

## File Structure

- `src/app/features/report-operacao/components/reporte-slide/reporte-slide.ts`: estado e validação do drawer; deriva o motivo único e fecha após confirmação.
- `src/app/features/report-operacao/components/reporte-slide/reporte-slide.html`: mostra somente `Motivo Refugo` quando `Qtde Refugo > 0`.
- `src/app/features/report-operacao/components/reporte-slide/reporte-slide.css`: remove layout do editor de quantidade/botões e mantém o select responsivo.
- `src/fma-http-endpoint.ts`: valida motivo apenas para refugo e traduz o payload interno para `codMotivoRefugo`.
- `src/app/core/offline/models/immediate-delivery-result.ts`: contrato discriminado `SYNCED | PENDING | ERROR`.
- `src/app/core/offline/services/immediate-command-delivery.service.ts`: aguarda o ciclo existente sem enviar diretamente e classifica o estado por `localId`.
- `src/app/features/report-operacao/models/report-operacao.model.ts`: publica o resultado discriminado do envio imediato.
- `src/app/features/report-operacao/services/report-operacao.service.ts`: encadeia captura local e observação remota.
- `src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.ts`: aplica histórico, fecha o drawer e apresenta feedback por resultado.
- Os respectivos arquivos `*.spec.ts` cobrem cada limite sem chamar a rede real.

### Task 1: Simplificar o Motivo Refugo no drawer

**Files:**
- Modify: `src/app/features/report-operacao/components/reporte-slide/reporte-slide.ts`
- Modify: `src/app/features/report-operacao/components/reporte-slide/reporte-slide.html`
- Modify: `src/app/features/report-operacao/components/reporte-slide/reporte-slide.css`
- Test: `src/app/features/report-operacao/components/reporte-slide/reporte-slide.spec.ts`

**Interfaces:**
- Consumes: `MotivoRefugoService.buscarMotivos(termo: string)` e `ReporteParcialDraft.refugoItens`.
- Produces: `ReporteSlide.salvar()` emitindo zero ou um `ReporteRefugoItem`; `confirmarReporte(reporte)` fecha o drawer.

- [ ] **Step 1: Escrever testes falhando para a exibição automática e o payload derivado**

Adicionar casos que alterem `quantidadeRefugo`, verifiquem a consulta automática e inspecionem o evento:

```ts
it('mostra Motivo Refugo automaticamente e remove controles de quantidade do motivo', () => {
  component.atualizarQuantidade('quantidadeRefugo', 2);
  fixture.detectChanges();

  expect(motivoService.buscarMotivos).toHaveBeenCalledWith('');
  expect(fixture.nativeElement.textContent).toContain('Motivo Refugo');
  expect(fixture.nativeElement.textContent).not.toContain('Editar Motivo');
  expect(fixture.nativeElement.textContent).not.toContain('Qtde do motivo');
  expect(fixture.nativeElement.textContent).not.toContain('Adicionar motivo');
});

it('deriva a quantidade do motivo da própria quantidade de refugo', () => {
  const emitted = vi.spyOn(component.reporteSolicitado, 'emit');
  component.atualizarQuantidade('quantidadeAprovada', 10);
  component.atualizarQuantidade('quantidadeRefugo', 2);
  component.atualizarMotivo('05');
  component.salvar();

  expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
    quantidadeRefugo: 2,
    refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 2 }],
  }));
});

it('permite retrabalho sem motivo e exige motivo quando há refugo', () => {
  component.atualizarQuantidade('quantidadeRetrabalho', 1);
  expect(component.canSave).toBe(true);

  component.atualizarQuantidade('quantidadeRefugo', 1);
  expect(component.canSave).toBe(false);
});
```

- [ ] **Step 2: Executar o spec e confirmar a falha**

Run: `npm test -- --watch=false --include='src/app/features/report-operacao/components/reporte-slide/reporte-slide.spec.ts'`

Expected: FAIL porque o botão/editor antigo ainda existe, a busca não começa pela quantidade e retrabalho ainda exige motivo.

- [ ] **Step 3: Substituir o editor por um único select condicional**

Remover `editingRefugo`, `quantidadeMotivo`, `refugoItens`, `editarRefugo()`, `atualizarQuantidadeMotivo()`, `adicionarMotivo()` e `removerMotivo()`. Em `atualizarQuantidade`, carregar opções na transição para refugo positivo e limpar o motivo quando voltar a zero:

```ts
if (campo === 'quantidadeRefugo') {
  if (this.round3(quantidade) > 0) {
    this.carregarMotivos();
  } else {
    this.motivoCodigo = '';
  }
}
```

Implementar a consulta idempotente e manter a descrição junto das opções:

```ts
motivoOptions: ReadonlyArray<{
  readonly label: string;
  readonly value: string;
  readonly descricao: string;
}> = [];

private carregarMotivos(): void {
  if (this.carregandoMotivos || this.motivoOptions.length > 0) return;
  this.carregandoMotivos = true;
  const request = ++this.motivosRequest;
  this.motivoService.buscarMotivos('').pipe(takeUntil(this.destroyed$)).subscribe({
    next: motivos => {
      if (request !== this.motivosRequest) return;
      this.motivoOptions = motivos.map(motivo => ({
        label: `${motivo.codigo} - ${motivo.descricao}`,
        value: motivo.codigo,
        descricao: motivo.descricao,
      }));
      this.carregandoMotivos = false;
      this.changeDetector.markForCheck();
    },
    error: () => {
      if (request !== this.motivosRequest) return;
      this.carregandoMotivos = false;
      this.validationMessage = 'Não foi possível carregar os motivos de refugo.';
      this.changeDetector.markForCheck();
    },
  });
}
```

No template, manter apenas:

```html
@if (quantidadeRefugo > 0) {
  <po-select
    name="reporteMotivoRefugo"
    p-label="Motivo Refugo"
    [p-options]="motivoOptions"
    [p-disabled]="salvando || carregandoMotivos"
    [ngModel]="motivoCodigo"
    (ngModelChange)="atualizarMotivo($event)"
  ></po-select>
}
```

Derivar no `salvar()`:

```ts
const motivo = this.motivoOptions.find(option => option.value === this.motivoCodigo);
const refugoItens: ReadonlyArray<ReporteRefugoItem> = motivo
  ? [{
      codigo: motivo.value,
      descricao: motivo.descricao,
      quantidade: this.round3(this.quantidadeRefugo),
    }]
  : [];
```

Alterar a validação para exigir `motivoCodigo` somente quando `round3(quantidadeRefugo) > 0`; `hasDraft` deve considerar apenas as três quantidades e `motivoCodigo`.

- [ ] **Step 4: Fechar o drawer após confirmação**

No final de `confirmarReporte()`:

```ts
this.resetDraft();
this.pwaWorkState.setCaptureActive('report-operation', false);
this.pageSlide.close();
this.changeDetector.markForCheck();
```

Adicionar ao teste existente de confirmação:

```ts
expect(pageSlide.close).toHaveBeenCalledOnce();
expect(pwaWorkState.setCaptureActive).toHaveBeenLastCalledWith('report-operation', false);
```

- [ ] **Step 5: Executar os testes do drawer**

Run: `npm test -- --watch=false --include='src/app/features/report-operacao/components/reporte-slide/reporte-slide.spec.ts'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/report-operacao/components/reporte-slide
git commit -m "feat: simplify operation scrap reason input"
```

### Task 2: Alinhar a validação e o POST do gateway

**Files:**
- Modify: `src/fma-http-endpoint.ts:430`
- Test: `src/fma-http-endpoint.spec.ts`

**Interfaces:**
- Consumes: payload `REPORT_OPERATION` com `quantidadeRefugo` e `refugoItens`.
- Produces: split externo `{ qtdAprovada, qtdRetrabalho, qtdRefugada, codMotivoRefugo }` para `ReporteOrdem`.

- [ ] **Step 1: Escrever testes falhando para retrabalho sem motivo e refugo obrigatório**

```ts
it('envia retrabalho sem exigir codMotivoRefugo', async () => {
  await postOperationReport({
    quantidadeAprovada: 10,
    quantidadeRetrabalho: 1,
    quantidadeRefugo: 0,
    refugoItens: [],
  });

  expect(fetchMock).toHaveBeenLastCalledWith(
    expect.stringContaining('/api/fma/v1/reporteordem'),
    expect.objectContaining({
      body: expect.stringContaining('"codMotivoRefugo":""'),
    }),
  );
});

it('rejeita refugo sem exatamente um motivo', async () => {
  await expect(postOperationReport({
    quantidadeAprovada: 10,
    quantidadeRetrabalho: 0,
    quantidadeRefugo: 2,
    refugoItens: [],
  })).rejects.toMatchObject({ status: 422 });
});
```

- [ ] **Step 2: Executar o spec e confirmar a falha do retrabalho sem motivo**

Run: `npm test -- --watch=false --include='src/fma-http-endpoint.spec.ts'`

Expected: FAIL porque `requiresReason` ainda considera `rework > 0`.

- [ ] **Step 3: Alterar a regra mínima no tradutor**

Em `reportSplit()`:

```ts
const requiresReason = scrap > 0;
if ((requiresReason && reasons.length !== 1) || (!requiresReason && reasons.length !== 0)) {
  throw invalidRequest(
    requiresReason
      ? 'Informe exatamente um motivo quando houver quantidade refugada.'
      : 'Não informe motivo quando a quantidade refugada for zero.',
  );
}
```

Preservar a tradução existente:

```ts
codMotivoRefugo: reasons.length === 1
  ? requiredText(reasons[0], 'codigo')
  : '',
```

- [ ] **Step 4: Executar o spec do gateway**

Run: `npm test -- --watch=false --include='src/fma-http-endpoint.spec.ts'`

Expected: PASS e o corpo esperado não contém uma propriedade de quantidade do motivo.

- [ ] **Step 5: Commit**

```bash
git add src/fma-http-endpoint.ts src/fma-http-endpoint.spec.ts
git commit -m "fix: require reason only for operation scrap"
```

### Task 3: Observar o resultado imediato de um comando local

**Files:**
- Create: `src/app/core/offline/models/immediate-delivery-result.ts`
- Create: `src/app/core/offline/services/immediate-command-delivery.service.ts`
- Create: `src/app/core/offline/services/immediate-command-delivery.service.spec.ts`

**Interfaces:**
- Consumes: `SyncCoordinatorService.requestSync(): Promise<void>`, `OutboxRepository.getById(ownerId, localId)`, `AuthSessionService.currentUser`, `SYNC_SCHEDULER_CONFIGURATION.requestTimeoutMs` e `SYNC_TIMEOUT_SCHEDULER`.
- Produces: `ImmediateDeliveryResult` e `ImmediateCommandDeliveryService.deliver(localId: string): Promise<ImmediateDeliveryResult>`.

- [ ] **Step 1: Escrever testes falhando para os três resultados e para timeout**

Usar stubs do coordenador/repositório e um scheduler controlado:

```ts
it.each([
  ['SYNCED', { status: 'SYNCED', receipt }],
  ['RETRY_WAIT', { status: 'PENDING' }],
  ['BLOCKED_AUTH', { status: 'PENDING' }],
  ['ERROR', { status: 'ERROR', error: persistedError }],
] as const)('classifica %s depois do ciclo', async (status, expected) => {
  coordinator.requestSync.mockResolvedValue(undefined);
  outbox.getById.mockResolvedValue({ ...entry, status, receipt, lastError: persistedError });

  await expect(service.deliver(entry.localId)).resolves.toEqual(expected);
});

it('devolve PENDING no limite sem cancelar o requestSync em andamento', async () => {
  coordinator.requestSync.mockReturnValue(new Promise<void>(() => undefined));
  outbox.getById.mockResolvedValue({ ...entry, status: 'SYNCING' });
  const delivery = service.deliver(entry.localId);
  scheduledCallback();

  await expect(delivery).resolves.toEqual({ status: 'PENDING' });
  expect(cancelScheduledTimeout).not.toHaveBeenCalled();
});
```

Também cobrir owner ausente e entrada ausente como erro de armazenamento, não como sucesso remoto.

- [ ] **Step 2: Executar o spec e confirmar que o serviço não existe**

Run: `npm test -- --watch=false --include='src/app/core/offline/services/immediate-command-delivery.service.spec.ts'`

Expected: FAIL com import não resolvido.

- [ ] **Step 3: Criar o contrato discriminado e o serviço**

```ts
export type ImmediateDeliveryResult =
  | { readonly status: 'SYNCED'; readonly receipt: RemoteCommandReceipt }
  | { readonly status: 'PENDING' }
  | { readonly status: 'ERROR'; readonly error: PersistedSyncError };

@Injectable({ providedIn: 'root' })
export class ImmediateCommandDeliveryService {
  constructor(
    private readonly coordinator: SyncCoordinatorService,
    private readonly outbox: OutboxRepository,
    private readonly auth: AuthSessionService,
    @Inject(SYNC_SCHEDULER_CONFIGURATION) private readonly config: SyncSchedulerConfig,
    @Inject(SYNC_TIMEOUT_SCHEDULER) private readonly scheduler: TimeoutScheduler,
  ) {}

  async deliver(localId: string): Promise<ImmediateDeliveryResult> {
    const ownerId = this.auth.currentUser?.id.trim();
    if (!ownerId) throw new Error('Não existe owner autenticado para observar o envio.');

    await this.waitForCycle();
    const entry = await this.outbox.getById(ownerId, localId);
    if (!entry) throw new Error('O comando salvo não foi encontrado na Outbox.');
    if (entry.status === 'SYNCED' && entry.receipt) {
      return { status: 'SYNCED', receipt: entry.receipt };
    }
    if (entry.status === 'ERROR' && entry.lastError) {
      return { status: 'ERROR', error: entry.lastError };
    }
    return { status: 'PENDING' };
  }

  private waitForCycle(): Promise<void> {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const cancel = this.scheduler.schedule(finish, this.config.requestTimeoutMs);
      void this.coordinator.requestSync().then(() => {
        cancel();
        finish();
      }, () => {
        cancel();
        finish();
      });
    });
  }
}
```

O timeout resolve apenas a espera. Não passar `AbortSignal` e não chamar o transport diretamente.

- [ ] **Step 4: Executar o spec do observador**

Run: `npm test -- --watch=false --include='src/app/core/offline/services/immediate-command-delivery.service.spec.ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/offline/models/immediate-delivery-result.ts src/app/core/offline/services/immediate-command-delivery.service.ts src/app/core/offline/services/immediate-command-delivery.service.spec.ts
git commit -m "feat: observe immediate outbox delivery result"
```

### Task 4: Encadear captura e entrega no ReportOperacaoService

**Files:**
- Modify: `src/app/features/report-operacao/models/report-operacao.model.ts:96`
- Modify: `src/app/features/report-operacao/services/report-operacao.service.ts:202`
- Test: `src/app/features/report-operacao/services/report-operacao.service.spec.ts`

**Interfaces:**
- Consumes: `ImmediateCommandDeliveryService.deliver(localId)` da Task 3.
- Produces: `ReporteOperacaoResultado extends ReporteResultado` com `delivery: ImmediateDeliveryResult` para a página; `ReporteResultado` permanece válido para `encerrarOperacao()`.

- [ ] **Step 1: Escrever testes falhando para ordem de captura e observação**

Registrar um mock `deliver` no TestBed e adicionar:

```ts
it('persiste antes de aguardar o resultado remoto pelo mesmo localId', async () => {
  const order: string[] = [];
  capture.mockImplementation(async () => {
    order.push('capture');
    return confirmation;
  });
  deliver.mockImplementation(async (localId: string) => {
    order.push(`deliver:${localId}`);
    return { status: 'SYNCED', receipt } as const;
  });

  const result = await firstValueFrom(service.reportarOperacao(request));

  expect(order).toEqual(['capture', `deliver:${confirmation.localId}`]);
  expect(result).toEqual({
    apontamentoId: confirmation.localId,
    reportadoEm: expect.any(Date),
    delivery: { status: 'SYNCED', receipt },
  });
});
```

Adicionar casos para `PENDING` e `ERROR`, sempre verificando uma única chamada a `capture`.

- [ ] **Step 2: Executar o spec e confirmar a falha de contrato**

Run: `npm test -- --watch=false --include='src/app/features/report-operacao/services/report-operacao.service.spec.ts'`

Expected: FAIL porque `delivery` ainda não existe e `deliver` não é chamado.

- [ ] **Step 3: Estender o DTO de resultado e encadear as promises**

```ts
export interface ReporteOperacaoResultado extends ReporteResultado {
  readonly delivery: ImmediateDeliveryResult;
}
```

Alterar somente a assinatura de `reportarOperacao()` para `Observable<ReporteOperacaoResultado>`. Injetar `ImmediateCommandDeliveryService` e substituir o `map` de `reportarOperacao()` por:

```ts
return from(this.commands.capture(command)).pipe(
  switchMap(confirmation => from(
    this.immediateDelivery.deliver(confirmation.localId),
  ).pipe(map(delivery => ({
    apontamentoId: confirmation.localId,
    reportadoEm,
    delivery,
  })))),
);
```

Extrair o literal `command` sem alterar campos, dependências, `aggregateId` ou idempotência. Não aplicar esse aguardo a `iniciarOperacao()` nem `encerrarOperacao()` neste plano.

- [ ] **Step 4: Executar o spec do service**

Run: `npm test -- --watch=false --include='src/app/features/report-operacao/services/report-operacao.service.spec.ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/report-operacao/models/report-operacao.model.ts src/app/features/report-operacao/services/report-operacao.service.ts src/app/features/report-operacao/services/report-operacao.service.spec.ts
git commit -m "feat: await operation report delivery outcome"
```

### Task 5: Apresentar o resultado correto ao operador

**Files:**
- Modify: `src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.ts:890`
- Modify: `src/app/features/report-operacao/models/report-operacao.model.ts:67`
- Modify: `src/app/features/report-operacao/components/reporte-slide/reporte-slide.html`
- Test: `src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.spec.ts`

**Interfaces:**
- Consumes: `ReporteOperacaoResultado.delivery` da Task 4 e `ReporteSlide.confirmarReporte()` da Task 1.
- Produces: feedback e marcação de histórico distintos para Datasul, pendência e rejeição definitiva sem duplicar histórico/comando.

- [ ] **Step 1: Atualizar a fixture padrão e escrever os três testes de feedback**

Fazer o mock padrão retornar `delivery: { status: 'PENDING' }`. Adicionar testes que abrem/iniciam a operação pelo helper já usado no spec e emitem um reporte:

```ts
it('confirma recebimento quando a Outbox reconcilia SYNCED', () => {
  service.reportarOperacao.mockReturnValue(of({
    apontamentoId: 'APT-1',
    reportadoEm: new Date('2026-08-28T10:00:00-03:00'),
    delivery: { status: 'SYNCED', receipt },
  }));

  submitReport({ quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

  expect(notification.success).toHaveBeenCalledWith('Reporte enviado ao Datasul.');
  expect(component.reportes).toHaveLength(1);
});

it('avisa quando o reporte local ficou pendente', () => {
  service.reportarOperacao.mockReturnValue(of({
    apontamentoId: 'APT-1', reportadoEm: new Date(), delivery: { status: 'PENDING' },
  }));

  submitReport({ quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

  expect(notification.warning).toHaveBeenCalledWith(
    'Datasul indisponível — reporte salvo como pendente.',
  );
  expect(component.reportes).toHaveLength(1);
});

it('não cria outro comando quando o Datasul rejeita o reporte', () => {
  service.reportarOperacao.mockReturnValue(of({
    apontamentoId: 'APT-1',
    reportadoEm: new Date(),
    delivery: { status: 'ERROR', error: persistedError },
  }));

  submitReport({ quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

  expect(service.reportarOperacao).toHaveBeenCalledOnce();
  expect(notification.error).toHaveBeenCalledWith(
    `${persistedError.userMessage} Abra o Centro de Sincronização para corrigir.`,
  );
  expect(component.reportes).toHaveLength(1);
});
```

No teste existente de clique duplicado do drawer, preservar explicitamente as asserções `emit` chamado uma vez e a mesma `idempotencyKey` reutilizada somente quando o rascunho é preservado após falha local.

- [ ] **Step 2: Executar o spec e confirmar as mensagens incorretas**

Run: `npm test -- --watch=false --include='src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.spec.ts'`

Expected: FAIL porque todos os resultados ainda exibem “Salvo neste dispositivo — envio pendente”.

- [ ] **Step 3: Corrigir a validação de motivo na página**

Trocar:

```ts
const requiresReason = quantidadeRefugo > 0;
```

e ajustar os textos para `Informe exatamente um motivo de refugo...` e `Remova o motivo..., pois não há refugo.`. A validação da quantidade interna continua garantindo que o item derivado tenha `quantidadeRefugo > 0`.

- [ ] **Step 4: Ramificar o feedback depois de registrar o histórico uma única vez**

Acrescentar ao modelo histórico uma propriedade opcional, mantendo compatibilidade com reportes antigos:

```ts
export interface ReporteParcialOperacao {
  // campos existentes permanecem inalterados
  readonly deliveryStatus?: ImmediateDeliveryResult['status'];
}
```

Ao construir `reporte`, preencher `deliveryStatus: result.delivery.status`. No template do histórico, exibir um texto acessível por reporte:

```html
<small class="reporte-slide__delivery-status">
  {{ reporte.deliveryStatus === 'SYNCED'
    ? 'Enviado ao Datasul'
    : reporte.deliveryStatus === 'ERROR'
      ? 'Rejeitado pelo Datasul'
      : 'Envio pendente' }}
</small>
```

Reportes antigos sem a propriedade são apresentados como `Envio pendente`, pois não existe receipt local associado ao item restaurado nessa fronteira.

Depois de `confirmarReporte(reporte)` e antes do fluxo de finalizar split:

```ts
switch (result.delivery.status) {
  case 'SYNCED':
    this.feedback = 'Reporte enviado ao Datasul. A operação continua ativa.';
    this.notification.success('Reporte enviado ao Datasul.');
    break;
  case 'PENDING':
    this.feedback = 'Datasul indisponível — reporte salvo como pendente. A operação continua ativa.';
    this.notification.warning('Datasul indisponível — reporte salvo como pendente.');
    break;
  case 'ERROR':
    this.feedback = `${result.delivery.error.userMessage} Abra o Centro de Sincronização para corrigir.`;
    this.notification.error(this.feedback);
    break;
}
```

Não chamar `informarErro()` depois de `confirmarReporte()`, pois o rascunho já virou um comando Outbox. Preservar `finalizarSplit`: ele usa o mesmo reporte como dependência e segue o fluxo existente.

- [ ] **Step 5: Executar os specs da página e do drawer**

Run: `npm test -- --watch=false --include='src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.spec.ts' --include='src/app/features/report-operacao/components/reporte-slide/reporte-slide.spec.ts'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/report-operacao/models/report-operacao.model.ts src/app/features/report-operacao/components/reporte-slide/reporte-slide.html src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.ts src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.spec.ts
git commit -m "feat: show Datasul report delivery outcome"
```

### Task 6: Verificação integrada e atualização do grafo

**Files:**
- Modify generated graph files under: `graphify-out/`

**Interfaces:**
- Consumes: todos os contratos das Tasks 1–5.
- Produces: build verificável e grafo do repositório alinhado ao código.

- [ ] **Step 1: Executar a suíte focada completa**

Run:

```bash
npm test -- --watch=false \
  --include='src/app/core/offline/services/immediate-command-delivery.service.spec.ts' \
  --include='src/app/core/offline/repositories/outbox.repository.spec.ts' \
  --include='src/app/core/offline/services/sync-coordinator.service.spec.ts' \
  --include='src/app/features/report-operacao/components/reporte-slide/reporte-slide.spec.ts' \
  --include='src/app/features/report-operacao/services/report-operacao.service.spec.ts' \
  --include='src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.spec.ts' \
  --include='src/fma-http-endpoint.spec.ts'
```

Expected: PASS, sem chamadas reais ao Datasul.

- [ ] **Step 2: Executar o build de produção**

Run: `npm run build`

Expected: exit code 0; warnings preexistentes de orçamento não contam como falha.

- [ ] **Step 3: Atualizar e consultar o knowledge graph**

Run: `graphify update .`

Expected: atualização AST concluída.

Run: `graphify query "Como o botão Salvar reporte persiste REPORT_OPERATION, chama ReporteOrdem e apresenta SYNCED PENDING ERROR?"`

Expected: o subgrafo inclui `ReporteSlide`, `ReportOperacaoService`, `ImmediateCommandDeliveryService`, `SyncCoordinatorService` e `reportSplit`.

- [ ] **Step 4: Revisar o diff e confirmar ausência do campo removido**

Run: `rg -n "Quantidade do motivo|Qtde do motivo|Editar Motivo do Retrabalho/Ordem|Adicionar motivo" src/app/features/report-operacao`

Expected: nenhuma ocorrência no código/template de produção; textos históricos de testes removidos também devem estar ausentes.

Run: `git diff --check`

Expected: nenhuma saída.

- [ ] **Step 5: Commit final de artefatos gerados, se houver**

```bash
git add graphify-out
git commit -m "chore: update graph after report delivery flow"
```
