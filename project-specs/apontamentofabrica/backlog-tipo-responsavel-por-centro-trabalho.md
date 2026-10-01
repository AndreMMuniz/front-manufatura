# Backlog — tipo de responsável por centro de trabalho

**Situação:** correção local aplicada após evidência parcial do contrato; validação funcional e publicação pendentes
**Escopo:** Paradas, Reporte de Ordem e Reporte de Batelada
**Origem:** divergência observada em produção em setembro de 2026

## Objetivo e contrato esperado

Após informar a Área de Produção e selecionar um Centro de Trabalho (CT), os três módulos devem identificar se o responsável pelo reporte é **Operador** ou **Equipe**, sem presumir Operador quando a API não informa o tipo.

Dependência do Datasul: cada registro de `items[].centrosTrabalho` da resposta de `GET /api/fma/v1/centrostrabalho?companyId=...&codUsuario=...&codAreaProduc=...` deve conter a modalidade **numérica**, com `2` para Operador e `3` para Equipe. O nome observado em 01/10/2026 é `indReportMod`; o gateway normaliza esse campo para `indReporteMod`. O campo deve representar a regra do CT para os três módulos e estar presente nas bases de homologação e produção. Confirmar com o responsável pela API se a regra é realmente fixa por CT; `GET /api/fma/v1/abrirapontamento` já devolve `indReporteMod` para uma ordem/operação/split e pode revelar uma divergência.

Exemplo mínimo para validar o contrato, sem dados sensíveis:

```json
{
  "codAreaProduc": "4110",
  "codCtrab": "EMP-01-01",
  "desCtrab": "EMPACOTADORA AUTOMÁTICA MASIPACK 1",
  "indReportMod": 2
}
```

`GET /api/fma/v1/operadores` fornece `codOperador`; `GET /api/fma/v1/equipes` fornece `codEquipe`. Essas listas não identificam a modalidade do CT. Elas só oferecem candidatos após a modalidade ser conhecida.

## Diagnóstico anterior à correção de 01/10/2026

| Fluxo | Comportamento atual | Risco com o contrato incompleto |
| --- | --- | --- |
| Gateway compartilhado | `/api/work-centers` copia `indReporteMod` ou `indReportMod` quando vale `2` ou `3`; caso contrário omite o campo. | A ausência passa despercebida para as telas. |
| Paradas | Na seleção do CT, usa `indReporteMod`; quando ausente, assume `OPERADOR`. O tipo aparece somente para leitura. Código de operador é digitado; equipe vem de lista. | Pode enviar `codOperador` para CT que requer `codEquipe`; não há escolha manual de tipo. |
| Reporte de Ordem | Ao abrir uma OP, `/api/fma/v1/abrirapontamento` pode devolver `indReporteMod` e a tela bloqueia a troca de tipo. Sem o valor da abertura, resta a escolha manual, inicialmente Operador. | Antes de abrir a OP o CT não define o tipo; se as duas APIs discordarem, não há tratamento de conflito. |
| Reporte de Batelada | Depois de selecionar área/CT e ordens, o tipo permanece manual e inicia em `OPERADOR`; não lê `indReporteMod` do CT. | Pode iniciar ou reportar o lote com responsável incompatível com o CT. |
| Entrada em Paradas por Ordem/Batelada | Leva um `preferredResponsible` da tela de origem. | O prefill pode divergir do novo modo obrigatório do CT. |

Referências principais: `src/fma-http-endpoint.ts`, `src/app/features/shop-floor/models/work-center.ts`, `src/app/features/reporte-paradas/`, `src/app/features/report-operacao/` e `src/app/features/reporta-batelada/`.

## Itens de execução

### TR-01 — Confirmar contrato Datasul (bloqueante)

**Prioridade:** P0 · **Responsável:** equipe Datasul · **Estado:** evidência parcial recebida; confirmação funcional pendente

- Entregar uma resposta real de `centrostrabalho` com CT de modalidade 2 e outra com CT de modalidade 3, em homologação e produção, omitindo credenciais.
- Confirmar nome, tipo e semântica do campo, e se o modo é fixo por CT ou depende da OP/operação/split.
- Comparar `indReporteMod` do CT com o valor de `abrirapontamento` para pelo menos uma OP de cada modalidade.
- Confirmar o comportamento para CT sem configuração e valores diferentes de 2/3.

**Aceite:** contrato documentado e exemplos válidos das duas modalidades. Se o modo variar por operação, revisar TR-03 a TR-06 antes de implementá-los.

### TR-02 — Validar e publicar o modo no gateway

**Prioridade:** P1 · **Dependência:** TR-01 · **Estado:** correção local aplicada; validação funcional pendente

- Atualizar o adaptador de `/api/work-centers` para validar `indReporteMod` de cada CT selecionável; não transformar ausência ou valor inválido em Operador.
- Preservar `code` e `areaCode` para vincular o modo ao CT correto, sem aplicar o modo de outro CT da mesma área.
- Definir erro recuperável para contrato ausente/inválido e mensagem clara na interface; impedir comandos novos enquanto o tipo é desconhecido.
- Atualizar modelo `WorkCenter` e documentação do contrato. Manter `codOperador`/`codEquipe` como strings, inclusive zeros à esquerda.

**Aceite:** respostas 2 e 3 chegam corretamente às três telas; resposta ausente/inválida não produz modalidade presumida nem comando com tipo incorreto.

### TR-03 — Aplicar modalidade em Paradas

**Prioridade:** P1 · **Dependência:** TR-02 · **Estado:** correção local aplicada; validação funcional pendente

- Ao selecionar ou restaurar área/CT, exibir Operador para 2 e Equipe para 3.
- Para 2, solicitar código de operador; para 3, listar equipes elegíveis. Limpar código escolhido quando o CT mudar.
- Conferir prefill vindo de Reporte de Ordem ou Batelada com a modalidade do CT. Se houver conflito, mostrar erro e pedir reconciliação, sem trocar silenciosamente o responsável.
- Validar novamente o tipo antes de criar a parada; preservar comandos já gravados e paradas em andamento com sua identidade original.

**Aceite:** os dois tipos aparecem corretamente; um CT de equipe nunca gera nova parada com `codOperador` e vice-versa; troca de CT não reutiliza o código anterior.

### TR-04 — Aplicar modalidade em Reporte de Ordem

**Prioridade:** P1 · **Dependência:** TR-02 · **Estado:** correção local aplicada; validação funcional pendente

- Identificar e mostrar o tipo pelo CT assim que área/CT forem selecionados, antes da abertura da OP.
- Comparar o valor do CT com `indReporteMod` de `abrirapontamento`. Se divergirem, sinalizar inconsistência de contrato e não iniciar nova operação nem enviar novo reporte com tipo presumido; definir tratamento específico para operação já iniciada sem perder seu responsável registrado.
- Manter o responsável alocado em operação já iniciada quando coerente; limpar seleção pendente ao trocar área, CT ou OP.
- Enviar somente o campo de código correspondente (`codOperador` ou `codEquipe`) nos comandos de início e reporte.

**Aceite:** o modo mostrado antes e depois de abrir a OP é coerente; conflito entre APIs é visível e não gera comando novo ambíguo; operação já iniciada mantém seu estado para diagnóstico/correção.

### TR-05 — Aplicar modalidade em Reporte de Batelada

**Prioridade:** P1 · **Dependência:** TR-02 · **Estado:** correção local aplicada; validação funcional pendente

- Inicializar o tipo pelo CT e impedir troca manual quando o modo é conhecido.
- Limpar responsável, composição ainda não iniciada e seleções incompatíveis quando área/CT mudarem, respeitando as travas do lote já iniciado.
- Antes de iniciar ou reportar, validar que o responsável corresponde ao modo do CT. Tratar incompatibilidade de modo entre operações da composição se a API de abertura a revelar.
- Preservar modalidade e código originais de bateladas já iniciadas ou restauradas da persistência local; tratar conflitos sem reescrever comandos pendentes.
- Aplicar o mesmo tipo ao prefill de Paradas aberto pela Batelada.

**Aceite:** CT 2 aceita apenas Operador; CT 3 aceita apenas Equipe; lote misto/inconsistente não envia comando; lote em andamento pode ser retomado sem perda do responsável.

### TR-06 — Verificar códigos e rejeição do Datasul

**Prioridade:** P1 · **Dependências:** TR-03 a TR-05 · **Estado:** pendente

- Para o caso do operador informado no ticket, comparar o código exato digitado com `codOperador` retornado por `/api/fma/v1/operadores` na mesma empresa e usuário da produção; não converter para número nem completar zeros por suposição.
- Confirmar com o Datasul se operadores/equipes com `codAreaProduc` vazio são globais ou inelegíveis; o gateway hoje filtra por igualdade com a área.
- Testar uma parada, uma ordem e uma batelada de cada modalidade em homologação, conferindo os corpos enviados a `iniciaparada`/`incluiparada`, `iniciaordem`/`reporteordem` e `iniciarordembatelada`/`reporteordembatelada`.

**Aceite:** cada comando leva o código íntegro no campo correto; rejeições de cadastro ou elegibilidade são atribuídas ao retorno real do Datasul.

### TR-07 — Cobertura e liberação

**Prioridade:** P1 · **Dependências:** TR-02 a TR-06 · **Estado:** pendente

- Testar no adaptador e nas três telas: modo 2, modo 3, ausência, valor inválido, troca de área/CT, prefill, API conflitante, erro de rede e retomada de operação/lote/parada já iniciados.
- Exercitar cenário integrado com CT real de cada modalidade nas duas bases antes de publicar.
- Comparar versão do front e configuração do Datasul em homologação e produção; registrar evidências sem credenciais.

**Aceite:** testes automatizados dos fluxos afetados passam; testes funcionais mostram o mesmo tipo para o mesmo CT e códigos corretos nos comandos.

## Dados necessários para concluir a validação funcional

1. Dois JSONs completos de `centrostrabalho` (CT 2 e CT 3) após a alteração, com área, `codCtrab` e `indReporteMod`, sem autenticação/segredos.
2. Para cada CT, resposta de `abrirapontamento` de uma OP representativa, quando houver OP, para confirmar a precedência entre as duas fontes.
3. Regra acordada para CT sem modo, para divergência entre as APIs e para `codAreaProduc` vazio nos cadastros de responsáveis.
4. Identificação do ambiente em que o contrato foi publicado e resultado do teste do operador citado no ticket.

## Atualização de 01/10/2026

O usuário forneceu resposta real da área `4122`, CT `PINT-02-01`, com **`indReportMod: 3`** (Equipe), e captura com HTTP `200 OK`. O nome observado no Datasul é `indReportMod`; o gateway já aceita esse nome e `indReporteMod`, normalizando ambos para `WorkCenter.indReporteMod`. Evidência preservada em `examples/centros-trabalho-company-1-area-4122-response.json`.

Após autorização do usuário, a correção local passou a usar a modalidade do CT em Paradas, Reporte de Ordem e Reporte de Batelada. O tipo é automático; Operador mantém o campo de código e Equipe mostra a seleção de equipes. Trocas de CT limpam responsáveis incompatíveis. Modalidade ausente/inválida bloqueia novos comandos; divergência entre CT e abertura da OP bloqueia início/reporte. Responsáveis e comandos já persistidos não são reescritos.

- **TR-01:** evidência parcial recebida para Equipe. Ainda faltam retorno real de Operador, confirmação dos ambientes e da coerência com `abrirapontamento`.
- **TR-02 a TR-05:** correção aplicada localmente. Validação no Datasul e publicação continuam pendentes.
- **TR-06:** pendente de teste funcional dos códigos e regras de elegibilidade.
- **TR-07:** 243 testes dos fluxos afetados passaram e a compilação de produção foi concluída. Liberação depende de validação funcional nas bases e publicação autorizada.
