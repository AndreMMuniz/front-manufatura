# Reporte de operação com envio imediato e fallback local

**Data:** 2026-08-28
**Status:** Aprovado pelo usuário

## Contexto

O drawer **Reporte da Ordem** hoje permite informar uma quantidade própria para o motivo, embora o contrato externo `POST /api/fma/v1/reporteordem` envie somente as quantidades gerais e `codMotivoRefugo`. O botão **Salvar reporte** confirma assim que o comando é persistido na Outbox, sem aguardar a tentativa remota; por isso o operador não sabe, naquele momento, se o Datasul recebeu o reporte.

O projeto exige que escritas operacionais sejam persistidas localmente antes de qualquer escrita remota. A solução deve preservar essa garantia e, ao mesmo tempo, produzir a experiência de envio imediato solicitada.

## Objetivos

- Remover do drawer a quantidade específica do motivo.
- Remover as ações **Editar motivo** e **Adicionar motivo**.
- Exibir o dropdown **Motivo Refugo** automaticamente quando `Qtde Refugo > 0`.
- Exigir motivo somente quando houver refugo; retrabalho sem refugo não exige motivo.
- Ao salvar, tentar enviar imediatamente e aguardar um resultado remoto observável.
- Se a tentativa remota não puder ser concluída por falha transitória de comunicação, preservar o reporte localmente como pendente.
- Se o Datasul responder com rejeição funcional, preservar somente o histórico técnico terminal, sem incorporar o reporte ao negócio nem criar demanda de retry.
- Impedir crescimento indefinido da base local sem comprometer dependências, histórico ativo ou auditoria de falhas.
- Manter idempotência entre tentativa imediata, timeout e reenvios posteriores.

## Fora de escopo

- Alterar o contrato externo do Datasul.
- Chamar o endereço do Datasul diretamente pelo navegador.
- Armazenar credenciais Datasul ou JWT na Outbox.
- Alterar o fluxo de reporte em batelada.
- Remover o Centro de Sincronização ou a capacidade de correção manual.

## Experiência do drawer

O formulário apresentará sempre:

- `Qtde Aprovada`
- `Qtde Retrabalho`
- `Qtde Refugo`

Quando `Qtde Refugo` for maior que zero, o formulário exibirá imediatamente:

- `Motivo Refugo`, como dropdown carregado por `/api/scrap-reasons`

Não existirão o botão **Editar Motivo do Retrabalho/Ordem**, o campo **Qtde do motivo**, o botão **Adicionar motivo** nem a lista editável de motivos.

### Regras de estado

- Ao mudar `Qtde Refugo` de zero para um valor positivo, o dropdown aparece e o catálogo é carregado, caso ainda não esteja disponível.
- Ao mudar `Qtde Refugo` para zero, o motivo selecionado é limpo.
- Enquanto `Qtde Refugo > 0`, salvar exige exatamente um motivo válido.
- Quando `Qtde Refugo = 0`, nenhum motivo é enviado, mesmo que exista retrabalho.
- Valores negativos ou não finitos continuam inválidos.
- O drawer bloqueia cliques duplicados enquanto o salvamento está em andamento.

## Compatibilidade do modelo interno

Para reduzir o risco sobre comandos pendentes já persistidos, o formato interno `refugoItens` será mantido nesta entrega. A tela produzirá no máximo um item:

```json
{
  "codigo": "05",
  "descricao": "Borra",
  "quantidade": 2
}
```

O campo interno `quantidade` será derivado de `quantidadeRefugo`; não será digitado pelo operador. Comandos antigos continuam legíveis. O adaptador do gateway continuará enviando ao Datasul somente:

```json
{
  "qtdAprovada": 10,
  "qtdRetrabalho": 1,
  "qtdRefugada": 2,
  "codMotivoRefugo": "05"
}
```

A validação do gateway será alinhada à evidência do contrato fornecido: motivo obrigatório apenas quando `qtdRefugada > 0`; retrabalho isolado aceita `codMotivoRefugo: ""`.

## Fluxo de salvamento

O comportamento será local-first tecnicamente e imediato para o usuário:

1. O usuário clica em **Salvar reporte**.
2. O frontend valida quantidades e motivo.
3. Um comando idempotente `REPORT_OPERATION` é persistido atomicamente na IndexedDB.
4. A aplicação solicita uma sincronização imediata e acompanha o `localId` persistido.
5. O coordenador respeita as dependências do comando. Se `START_OPERATION` ainda estiver pendente, ele é entregue antes do reporte.
6. O handler envia `POST /api/operations/report` ao gateway.
7. O gateway adapta o corpo e envia `POST /api/fma/v1/reporteordem` ao Datasul.
8. A interface aguarda um dos resultados descritos abaixo.

O navegador nunca chamará o IP do Datasul diretamente. O Network do navegador mostrará `/api/operations/report`; o gateway faz a chamada externa com Basic Auth somente no servidor.

## Resultados apresentados ao operador

### Sucesso remoto

Quando a Outbox recebe e reconcilia o receipt remoto:

- o drawer fecha e o rascunho é limpo;
- a interface informa **Reporte enviado ao Datasul**;
- o histórico local marca o reporte como sincronizado;
- o receipt remoto fica disponível para diagnóstico sem dados sensíveis.

### Falha transitória ou indisponibilidade

Em falha de rede, timeout, servidor indisponível ou ausência temporária de sessão online:

- o comando já persistido permanece `PENDING` ou no estado de retry aplicável;
- o drawer fecha e o rascunho é limpo, pois os dados já estão duráveis;
- a interface informa **Datasul indisponível — reporte salvo como pendente**;
- o Centro de Sincronização continua responsável por retry e visibilidade.

### Rejeição funcional definitiva

Em validação, conflito ou rejeição funcional explicitamente devolvida pelo Datasul:

- o comando permanece rastreável como histórico terminal `REJECTED`;
- o comando não entra na fila ativa, não recebe retry automático ou manual e não oferece correção no Centro de Sincronização;
- o reporte rejeitado não é incorporado aos totais nem ao histórico de negócio da operação;
- o drawer preserva os dados apresentados e exibe somente o motivo seguro devolvido pelo Datasul;
- a operação permanece ativa e uma nova ação explícita do operador nasce como outro comando, sem reutilizar silenciosamente a rejeição.

### Resposta perdida após processamento

Se o Datasul processar o reporte, mas a resposta se perder, o retry reutilizará a mesma chave de idempotência e o mesmo payload canônico. O gateway deve devolver o mesmo resultado ou uma confirmação duplicada, nunca criar outro apontamento.

## Acompanhamento da entrega

Será criada uma fronteira de serviço para aguardar a entrega de um comando específico sem acoplar o componente à IndexedDB. Essa fronteira receberá o `localId`, solicitará sincronização e resolverá com um resultado discriminado:

- `SYNCED`, com receipt remoto;
- `PENDING`, quando a entrega imediata não for possível;
- `ERROR`, com classificação segura e corrigível quando aplicável.

A espera da UI usará o mesmo limite de 30 segundos da requisição de sincronização. A expiração dessa espera não cancela nem duplica o comando: apenas devolve `PENDING`, deixando a Outbox continuar o trabalho.

## Retenção e tamanho da base local

Persistir antes de enviar não deve significar retenção eterna. A limpeza seguirá estas regras:

- nunca remover comandos pendentes, em sincronização, bloqueados ou com erro;
- nunca remover um comando enquanto houver dependentes ativos;
- manter reportes sincronizados enquanto a operação correspondente estiver ativa, pois o histórico e o encadeamento dependem deles;
- após a sincronização do encerramento da operação, compactar o payload do agregado concluído na próxima rotina de limpeza;
- preservar receipt, idempotency key, timestamps e status por 30 dias, limitados aos 500 registros mais recentes por usuário;
- executar limpeza limitada em startup e após ciclos de sincronização, sem bloquear a interface.

A retenção será baseada em estado e dependências, não apenas em idade ou quantidade bruta de registros.

## Arquivos e responsabilidades afetadas

- `reporte-slide.html` e `reporte-slide.ts`: formulário simplificado, dropdown condicional e estado singular do motivo.
- `reporte-slide.spec.ts`: comportamento visual, limpeza do motivo, validação e bloqueio de duplicidade.
- `report-operacao-page.ts`: feedback de envio remoto, pendência e erro.
- `report-operacao.service.ts`: captura do comando e acompanhamento do resultado imediato.
- serviços de Outbox/sincronização: observação segura da entrega por `localId` e política de compactação.
- `fma-http-endpoint.ts`: regra de motivo alinhada a refugo, preservando o payload externo.
- testes do gateway e da sincronização: contrato, idempotência, dependências e retenção.

## Testes de aceitação

1. Refugo zero não exibe `Motivo Refugo`.
2. Refugo positivo exibe o dropdown sem botões intermediários.
3. Voltar o refugo para zero oculta e limpa o motivo.
4. Retrabalho positivo com refugo zero permite salvar sem motivo.
5. Refugo positivo sem motivo bloqueia o salvamento.
6. O payload externo contém as três quantidades e somente o código do motivo.
7. Salvamento online aguarda e apresenta confirmação remota.
8. Falha transitória mantém exatamente um comando pendente e apresenta fallback local.
9. Rejeição funcional fica apenas no histórico terminal, não altera os totais e não oferece retry ou correção.
10. Timeout após processamento não duplica o reporte no retry.
11. Um `START_OPERATION` pendente é entregue antes do `REPORT_OPERATION` dependente.
12. Dois cliques rápidos produzem um único comando e uma única chave idempotente.
13. A compactação não remove pendências, erros ou comandos com dependentes ativos.
14. Um agregado concluído e sincronizado torna-se elegível para compactação.

## Observabilidade e segurança

- O cliente pode observar o status do endpoint interno, mas não recebe credenciais nem Basic Auth.
- A confirmação significa que o Datasul respondeu com sucesso ao POST. Como `ReporteOrdem` não possui um contrato de leitura/eco documentado, ela não prova isoladamente como cada campo foi persistido; essa conferência continua pertencendo à homologação no Datasul.
- Logs registram rota normalizada, classificação, duração e correlação, sem corpo operacional completo, usuário em query ou segredo.
- A UI diferencia claramente confirmação Datasul de persistência pendente.
- O receipt remoto é sanitizado antes de persistência ou exibição.

## Migração e implantação

- Comandos antigos com `refugoItens[].quantidade` permanecem compatíveis.
- A mudança não exige migração destrutiva da IndexedDB.
- A política de compactação entra somente após testes de dependência e restauração de operação ativa.
- A funcionalidade deve ser homologada com uma ordem autorizada, verificando o receipt e o resultado no Datasul.

## Decisão

Adotar persistência local antes do envio, tentativa remota imediata com espera limitada, fallback pendente e compactação segura. Não adotar POST direto antes da Outbox, pois existe risco de perda entre a interação do usuário e a persistência local.
