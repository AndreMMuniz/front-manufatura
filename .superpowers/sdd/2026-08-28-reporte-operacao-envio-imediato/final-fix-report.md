# Final fix report — envio imediato do reporte de operação

Data: 2026-08-28
Base revisada: `f23d698`
Commit técnico: `0db8c30` (`fix: reconcile corrected operation reports`)
Status: concluído

## Escopo e decisão integrada

A correção preserva a captura local antes de qualquer tentativa remota e o timeout de 30.000 ms sem cancelamento do sync. A projeção de restauração agora combina `LocalRecord + Outbox` do owner observado, considera somente `deliveryDisposition=ACTIVE`, deriva o estado atual e usa a cadeia de supersessão já persistida. O resultado da captura propaga `supersedesLocalId`; página, workflow e drawer substituem a entrada rejeitada na mesma posição sem duplicar totais. Nenhuma migração ou política de retenção foi alterada.

## Mapeamento dos findings 1–7

1. Race após `getById`: `src/app/core/offline/services/immediate-command-delivery.service.ts:22-80` observa um epoch por chamada, revalida após o ciclo e após a leitura da Outbox e falha se a sessão mudou, inclusive A→B→A. Regressão em `src/app/core/offline/services/immediate-command-delivery.service.spec.ts:158-190`.
2. Restauração owner-scoped: `src/app/features/report-operacao/services/report-operacao.service.ts:159-250` lê sequencialmente os dois repositórios, revalida owner/epoch após cada await, filtra versões não ativas, ordena por posição lógica e projeta `SYNCED/ERROR/PENDING`; `:506-523` contém derivação e guarda. Regressões em `report-operacao.service.spec.ts:107-178` cobrem supersessão, status e race de owner.
3. Bloqueio após ERROR: `src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.ts:235-239` desabilita a ação e `:903-910` mantém a guarda interna. `:1322-1342` só libera contexto `REPORT_OPERATION` para o `sourceLocalId` e agregado exatos. Regressão em `report-operacao-page.spec.ts:485-527`.
4. Substituição sem duplicidade: `src/app/core/offline/services/operational-command.facade.ts:129-139` e `report-operacao.service.ts:283-294` propagam `supersedesLocalId`; modelos em `report-operacao.model.ts:77-108`. A reconciliação ocorre em `report-operacao-page.ts:996-1021,1345-1360`, `report-operacao-workflow-state.ts:154-182` e `reporte-slide.ts:188-208`. Regressão parametrizada `ERROR→correção→SYNCED/PENDING→END` em `report-operacao-page.spec.ts:528-588`; facade/serviço também verificam a propagação.
5. Idempotência ao mudar motivo: `src/app/features/report-operacao/components/reporte-slide/reporte-slide.ts:131-138` limpa a chave somente quando o código realmente muda. Regressão em `reporte-slide.spec.ts:142-168` confirma preservação do rascunho idêntico e chave nova para payload alterado.
6. Envelopes inválidos: `immediate-command-delivery.service.ts:47-64` lança `OfflineStorageError('SCHEMA_INVALID')` para `SYNCED` sem receipt e `ERROR` sem lastError. Casos parametrizados em `immediate-command-delivery.service.spec.ts:188-206`.
7. Rótulos DOM: `src/app/features/report-operacao/components/reporte-slide/reporte-slide.spec.ts:200-235` cobre `SYNCED → Enviado ao Datasul`, `ERROR → Rejeitado pelo Datasul` e legado sem status → `Envio pendente` contra o DOM real.

## Evidência TDD — RED

- `npx ng test --watch=false --include='src/app/core/offline/services/immediate-command-delivery.service.spec.ts'`: 3 falhas esperadas/16 (race devolvia `SYNCED`; envelopes inválidos devolviam `PENDING`).
- `npx ng test --watch=false --include='src/app/features/report-operacao/services/report-operacao.service.spec.ts'`: 4 falhas esperadas/27 (Outbox não consultada, status não projetado, race não observada, supersessão não propagada).
- `npx ng test --watch=false --include='src/app/features/report-operacao/pages/report-operacao-page/report-operacao-page.spec.ts'`: 3 falhas esperadas/50 (ERROR não bloqueava; correções eram acrescentadas).
- `npx ng test --watch=false --include='src/app/core/offline/services/operational-command.facade.spec.ts'`: 1 falha esperada/19 (`supersedesLocalId` ausente).
- `npx ng test --watch=false --include='src/app/features/report-operacao/components/reporte-slide/reporte-slide.spec.ts'`: 1 falha esperada/18 (motivo alterado reutilizava a chave).

## Evidência GREEN e verificação

- Focados: entrega `16/16`; serviço `27/27`; página `50/50`; facade + slide + workflow `46/46`.
- Integrada relevante, executada uma vez: `npx ng test --watch=false --include='src/app/features/report-operacao/**/*.spec.ts' --include='src/app/core/offline/services/immediate-command-delivery.service.spec.ts' --include='src/app/core/offline/services/operational-command.facade.spec.ts' --include='src/app/core/offline/repositories/local-command.repository.spec.ts' --include='src/app/core/offline/services/operational-correction-context.service.spec.ts'` → 14 arquivos, 201/201 testes, exit 0.
- `npm run build` → exit 0. Permanecem apenas warnings preexistentes de budget CSS/bundle e CommonJS `js-sha256`.
- `git diff --check` → sem erros.
- `graphify update .` → primeira execução bloqueada pelo sandbox; repetição autorizada concluiu com 3.430 nós, 7.710 arestas e 174 comunidades.

## Self-review

- Local-first preservado: `commands.capture()` ainda conclui antes de `immediateDelivery.deliver()`.
- Timeout preservado: `waitForCycle()` continua resolvendo sem cancelar `requestSync`.
- Owner revalidado antes, entre e depois dos awaits; a assinatura do epoch detecta retorno ao mesmo owner.
- Somente a versão ativa participa de operação aberta, histórico, totais e dependências de END; comandos legados sem disposição/status continuam legíveis.
- Correção exata usa o fluxo de supersessão existente; uma correção novamente rejeitada continua `ERROR` e volta a bloquear novo reporte.
- Nenhuma alteração em migração, schema IndexedDB ou retenção.

## Concerns

Sem concern funcional aberto. Warnings de build citados acima permanecem fora deste wave. O commit que contém este relatório é documental e será informado no handoff junto de `0db8c30`.
