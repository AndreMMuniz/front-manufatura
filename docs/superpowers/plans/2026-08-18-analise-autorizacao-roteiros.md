# Análise de Roteiros Autorizados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que usuários `fcq-0002` carreguem todos os componentes de uma ficha pendente, salvem correções online e finalizem o roteiro com autorização em um painel lateral dedicado.

**Architecture:** O BFF terá endpoints exclusivos protegidos por `AUTORIZACAO_ROTEIRO_DIVERGENCIA`, sem ampliar os endpoints de `fcq-0001`. O frontend usará os modelos de exame existentes, mapeamento estrito por `nrFicha` e estado transitório por componente; apenas as respostas do Datasul determinarão `dentroFaixa` e o sucesso final.

**Tech Stack:** Angular 21 standalone components e signals, RxJS 7, PO UI 21, Express 5, TypeScript 5.9, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-18-analise-autorizacao-roteiros-design.md`

## Global Constraints

- `fcq-0002` usa somente endpoints sob `/api/quality-control/route-authorizations`.
- `companyId` vem da configuração e `codUsuario` da sessão Bearer.
- Componentes começam como **Não verificado**; somente resultados salvos nesta sessão ganham estado.
- `dentroFaixa` remoto é a única decisão funcional; não recalcular no frontend.
- `finalizado: false` preserva a `mensagem` de negócio.
- Sem dependências novas e sem Outbox/offline neste fluxo.
- Bloquear requisições duplicadas durante operações em andamento.

---

### Task 1: Endpoints BFF de análise autorizada

**Files:**
- Modify: `src/quality-control-http-endpoint.ts`
- Modify: `src/quality-control-datasul-client.ts`
- Test: `src/quality-control-http-endpoint.spec.ts`
- Test: `src/quality-control-datasul-client.spec.ts`

**Interfaces:**
- Consumes: `APP_PERMISSIONS.divergentRouteAuthorization`, `buildQualityResultPayload()` e `QualityControlDatasulClient`.
- Produces: `POST /route-authorizations/route`, `PUT /route-authorizations/results`, seleção estrita da ficha e validação do recibo.

- [ ] **Step 1: Escrever testes HTTP falhos dos novos endpoints**

Adicionar a `quality-control-http-endpoint.spec.ts` casos com token apenas `fcq-0002`:

```ts
const response = await fetch(`${root}/route-authorizations/route`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    nrFicha: 64462, nrOrdemProducao: 372562, codOperacao: 10,
    companyId: 999, codUsuario: 'NAO_CONFIAR',
  }),
});
expect(response.status).toBe(200);
expect(String(transport.mock.calls[0][0])).toBe(
  'https://datasul.example.test/api/fcq/v1/roteiros?companyid=1',
);
expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
  nrOrdemProducao: 372562, codOperacao: 10,
});
```

Testar que apenas `nrFicha: 64462` é devolvida quando o upstream contém várias fichas; ficha ausente/duplicada retorna 502. Para `PUT /route-authorizations/results`, testar payload numérico, tabelado e laudo, confirmar `codUsuario` da sessão e ignorar identidade/empresa do browser. Testar 403 para token apenas `fcq-0001`, 400 para representações misturadas e 405 para método incorreto.

- [ ] **Step 2: Confirmar que os testes falham**

Run: `npx vitest run src/quality-control-http-endpoint.spec.ts`

Expected: FAIL com 404 nos novos caminhos.

- [ ] **Step 3: Implementar rotas e seleção da ficha**

Adicionar em `quality-control-http-endpoint.ts`:

```ts
app.post(`${ROOT}/route-authorizations/route`, async (req, res) => {
  await handle(req, res, dependencies, async client => {
    const body = objectBody(req.body);
    const expected = positiveInteger(body['nrFicha']);
    const upstream = await client.getRoute({
      nrOrdemProducao: positiveInteger(body['nrOrdemProducao']),
      codOperacao: positiveInteger(body['codOperacao']),
    });
    return selectAuthorizedRouteEnvelope(upstream, expected);
  }, APP_PERMISSIONS.divergentRouteAuthorization);
});

app.put(`${ROOT}/route-authorizations/results`, async (req, res) => {
  await handle(req, res, dependencies, (client, userId) =>
    client.saveResult(buildQualityResultPayload(objectBody(req.body), userId)),
    APP_PERMISSIONS.divergentRouteAuthorization);
});
```

`selectAuthorizedRouteEnvelope()` valida `total`, `hasNext === false`, `items`, `nrFicha` e `ds-roteiro`, exige uma correspondência e devolve `{ total: 1, hasNext: false, items: [match] }`. Instalar guards POST/PUT.

- [ ] **Step 4: Validar recibo de `ResultExames` no cliente**

Criar `validateResultEnvelope()` e usá-la em `saveResult()`. Exigir um item, identidade positiva, `dentroFaixa` booleano, totais não negativos/coerentes e representação válida de resultado. Não inferir `dentroFaixa`.

- [ ] **Step 5: Rodar testes do servidor**

Run: `npx vitest run src/quality-control-http-endpoint.spec.ts src/quality-control-datasul-client.spec.ts src/app/core/offline/services/quality-control-sync.handlers.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/quality-control-http-endpoint.ts src/quality-control-datasul-client.ts src/quality-control-http-endpoint.spec.ts src/quality-control-datasul-client.spec.ts
git commit -m "feat: add authorized route analysis endpoints"
```

---

### Task 2: Contratos e serviço online do frontend

**Files:**
- Modify: `src/app/features/quality-control/mappers/datasul-quality-control.mapper.ts`
- Modify: `src/app/features/quality-control/mappers/datasul-quality-control.mapper.spec.ts`
- Modify: `src/app/features/route-authorization/models/route-authorization.model.ts`
- Modify: `src/app/features/route-authorization/mappers/route-authorization.mapper.ts`
- Modify: `src/app/features/route-authorization/mappers/route-authorization.mapper.spec.ts`
- Modify: `src/app/features/route-authorization/services/route-authorization.service.ts`
- Modify: `src/app/features/route-authorization/services/route-authorization.service.spec.ts`

**Interfaces:**
- Consumes: `ProductionOrderRoute`, `QualityExam`, `AuthenticatedApiService`.
- Produces: `mapInspectionRouteEnvelopeForSheet()`, `AuthorizedComponentResultRequest`, `AuthorizedComponentSaveResult`, `AuthorizedRouteFinalizationOutcome`, `loadRoute()` e `saveComponent()`.

- [ ] **Step 1: Escrever testes falhos dos mapeadores**

```ts
expect(mapInspectionRouteEnvelopeForSheet(envelope, context, 64462).route.nrFicha)
  .toBe(64462);
expect(() => mapInspectionRouteEnvelopeForSheet(envelope, context, 99999))
  .toThrow('invalid-upstream-response');

expect(mapAuthorizedFinalizationEnvelope(finalization(64462, false, 5), 64462))
  .toMatchObject({ finalized: false, pendingComponents: 5 });
```

Testar também `mapAuthorizedComponentResultEnvelope()` com identidade exata e `dentroFaixa` true/false.

- [ ] **Step 2: Confirmar falha**

Run: `npx vitest run src/app/features/quality-control/mappers/datasul-quality-control.mapper.spec.ts src/app/features/route-authorization/mappers/route-authorization.mapper.spec.ts`

Expected: FAIL por símbolos ausentes e recusa ainda lançada como exceção.

- [ ] **Step 3: Implementar tipos e mapeadores**

```ts
export type AuthorizedComponentResultRequest =
  | { readonly kind: 'numeric'; readonly result: number }
  | { readonly kind: 'table'; readonly tableNumber: number; readonly optionSequence: number }
  | { readonly kind: 'report'; readonly report: string };

export interface AuthorizedComponentSaveResult {
  readonly sheetNumber: number;
  readonly examCode: number;
  readonly componentCode: number;
  readonly withinRange: boolean;
  readonly savedComponents: number;
  readonly totalComponents: number;
}
```

Criar união `AuthorizedRouteFinalizationOutcome` com sucesso e recusa. A recusa válida carrega `finalized: false`, `message`, totais, situação e exames; somente contrato/identidade inválida lança erro. Extrair a transformação de item do mapper de CQ e selecionar uma única `nrFicha`.

- [ ] **Step 4: Escrever testes falhos do serviço**

```ts
await firstValueFrom(service.loadRoute(route, 10));
expect(api.post).toHaveBeenCalledWith(
  '/api/quality-control/route-authorizations/route',
  { nrFicha: 64462, nrOrdemProducao: 372562, codOperacao: 10 },
);

await firstValueFrom(service.saveComponent(64462, 1845, 1, {
  kind: 'numeric', result: 24,
}));
expect(api.put).toHaveBeenCalledWith(
  '/api/quality-control/route-authorizations/results',
  { nrFicha: 64462, codExame: 1845, codComponente: 1, resultado: 24 },
);
```

Repetir para tabela e laudo.

- [ ] **Step 5: Implementar serviço e rodar testes**

`loadRoute()` valida IDs, chama POST e mapeia pelo número da ficha. `saveComponent()` converte a união discriminada em exatamente uma representação e chama PUT. Rodar: `npx vitest run src/app/features/quality-control/mappers/datasul-quality-control.mapper.spec.ts src/app/features/route-authorization`.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/quality-control/mappers src/app/features/route-authorization/models src/app/features/route-authorization/mappers src/app/features/route-authorization/services
git commit -m "feat: add authorized route analysis contracts"
```

---

### Task 3: Painel lateral de análise

**Files:**
- Create: `src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.ts`
- Create: `src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.html`
- Create: `src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.css`
- Create: `src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.spec.ts`

**Interfaces:**
- Consumes: modelos/serviço da Task 2 e `PoPageSlideComponent`.
- Produces: `open(route, operationCode)`, `analysisClosed` e `routeFinalized`.

- [ ] **Step 1: Escrever teste falho da abertura**

Testar que `open()` chama `loadRoute()`, abre o slide, exibe o alerta aprovado e inicia cada componente como **Não verificado**. Usar fixture com componentes numérico, tabelado, laudo e tipo desconhecido; conferir controle adequado e mensagem de tipo não suportado.

- [ ] **Step 2: Confirmar falha**

Run: `npx vitest run src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.spec.ts`

Expected: FAIL porque o componente não existe.

- [ ] **Step 3: Implementar estado e estrutura**

```ts
type ComponentSessionStatus =
  | 'unverified' | 'saving' | 'approved' | 'out-of-range' | 'error';

interface ComponentDraft {
  readonly status: ComponentSessionStatus;
  readonly result: string;
  readonly report: string;
  readonly selectedOptionKey: string;
  readonly message: string;
}
```

`open()` incrementa token de carregamento, limpa estado, abre o slide e ignora resposta obsoleta. Usar OnPush, signals, `takeUntilDestroyed`, Forms e módulos PO UI. O template agrupa exames, mostra alerta literal, dados do componente, controle por tipo, status textual e botão individual **Salvar**. Estados não dependem apenas de cor e feedback usa `aria-live`.

- [ ] **Step 4: Escrever testes falhos de salvamento**

```ts
service.saveComponent.mockReturnValue(of({
  sheetNumber: 64462, examCode: 1845, componentCode: 1,
  withinRange: true, savedComponents: 2, totalComponents: 6,
}));
component.save(componentModel);
expect(component.statusFor(componentModel)).toBe('approved');
expect(component.isLocked(componentModel)).toBe(true);
```

Repetir para `withinRange: false` (editável), erro (rascunho preservado) e duplo save com Subject pendente (uma chamada).

- [ ] **Step 5: Implementar validação, salvamento e fechamento**

Numérico aceita vírgula/ponto, finito e precisão configurada; tabela exige opção existente; laudo exige texto. Tipo desconhecido não salva. Aprovado bloqueia; fora de faixa segue editável. Rascunho não salvo exige confirmação ao fechar. Bloquear fechamento durante operação.

- [ ] **Step 6: Rodar testes e commit**

Run: `npx vitest run src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.spec.ts`

Expected: PASS.

```bash
git add src/app/features/route-authorization/components/route-analysis-slide
git commit -m "feat: add authorized route analysis slide"
```

---

### Task 4: Integrar análise e finalização

**Files:**
- Modify: `src/app/features/route-authorization/pages/route-authorization-page/route-authorization-page.ts`
- Modify: `src/app/features/route-authorization/pages/route-authorization-page/route-authorization-page.html`
- Modify: `src/app/features/route-authorization/pages/route-authorization-page/route-authorization-page.css`
- Modify: `src/app/features/route-authorization/pages/route-authorization-page/route-authorization-page.spec.ts`
- Modify: `src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.ts`
- Modify: `src/app/features/route-authorization/components/route-analysis-slide/route-analysis-slide.spec.ts`

**Interfaces:**
- Consumes: `RouteAnalysisSlide.open()` e `AuthorizedRouteFinalizationOutcome`.
- Produces: abertura pelo card, confirmação no painel, mensagem real e remoção apenas em sucesso.

- [ ] **Step 1: Alterar teste da página para abertura do painel**

```ts
component.requestAnalysis(route(64382), trigger);
expect(analysisSlide.open).toHaveBeenCalledWith(route(64382), 10);
expect(dialog.confirm).not.toHaveBeenCalled();
```

Testar que `routeFinalized` remove somente a ficha emitida e restaura foco ao fechar.

- [ ] **Step 2: Escrever testes de finalização no painel**

Com `finalized: false`, confirmar que a mensagem remota aparece e o painel segue aberto. Com `finalized: true`, esperar notificação, emissão e fechamento. Com erro HTTP, mostrar indisponibilidade. Dois confirms durante Subject pendente geram uma chamada.

- [ ] **Step 3: Integrar e implementar finalização**

Inserir `<app-route-analysis-slide>` na página e trocar o click do card para abrir análise usando a operação validada da consulta. Remover finalização direta/erro genérico da página. No painel, manter a confirmação atual; recusa preserva `outcome.message`, sucesso emite `{ sheetNumber, message }` e erro técnico não remove a ficha.

- [ ] **Step 4: Rodar testes e commit**

Run: `npx vitest run src/app/features/route-authorization`

Expected: PASS.

```bash
git add src/app/features/route-authorization
git commit -m "feat: integrate authorized route analysis flow"
```

---

### Task 5: Verificação, documentação e Graphify

**Files:**
- Modify: `project-specs/planodecontrole-api/autorizacao-roteiros.md`
- Modify: `graphify-out/*` via `graphify update .`

**Interfaces:**
- Consumes: fluxo das Tasks 1–4.
- Produces: contrato documentado, build aprovado e grafo atualizado.

- [ ] **Step 1: Atualizar documentação**

Documentar endpoints BFF, estado provisório **Não verificado**, ausência de resultados históricos, permissão `fcq-0002` e preservação de mensagem em recusa.

- [ ] **Step 2: Rodar suíte direcionada**

Run: `npx vitest run src/quality-control-http-endpoint.spec.ts src/quality-control-datasul-client.spec.ts src/app/features/quality-control/mappers/datasul-quality-control.mapper.spec.ts src/app/features/route-authorization`

Expected: PASS.

- [ ] **Step 3: Rodar build**

Run: `npm run build`

Expected: exit 0 sem erros TypeScript/template.

- [ ] **Step 4: Atualizar grafo**

Run: `graphify update .`

Expected: atualização AST concluída.

- [ ] **Step 5: Verificar e commit final**

Run: `git diff --check` e `git status --short`. Confirmar ausência de arquivos alheios.

```bash
git add project-specs/planodecontrole-api/autorizacao-roteiros.md graphify-out
git commit -m "docs: document authorized route analysis flow"
```
