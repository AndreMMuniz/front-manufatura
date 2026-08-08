# Ordens de produção

Consulta os dados de uma ordem de produção usados pela tela **Plano de Controle CQ**, incluindo operações e seus respectivos splits.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/ordens/{numeroOrdem}`
- Exemplo: `GET http://10.101.195.111:51080/api/fcq/v1/ordens/372562`
- Autenticação: HTTP Basic Auth
- Corpo da requisição: não se aplica

> As credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de caminho

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `numeroOrdem` | integer | Sim | Número da ordem de produção consultada. |

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `pageSize` | integer | Não confirmado | A interface de teste exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada observada. |

## Resposta observada

- Status HTTP: `200 OK`
- Formato: JSON
- Exemplo integral: [`examples/ordens-372562-response.json`](./examples/ordens-372562-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista de resultados da consulta. |
| `items[].ds-ordem-producao` | object | Contêiner dos dados de ordens de produção. O nome contém hífens e exige acesso por colchetes em JavaScript/TypeScript. |
| `items[].ds-ordem-producao.ordem` | array | Lista das ordens de produção encontradas. |

### Ordem de produção

O objeto de ordem contém identificação e datas da ordem, item fabricado, estabelecimento, depósito, quantidades, estado, prioridade e uma lista de operações em `operacoes`.

Campos relevantes observados:

- `nrOrdemProducao`: número da ordem de produção.
- `codItem`: código do item fabricado.
- `qtdOrdem`: quantidade total da ordem.
- `qtdProduzida`, `qtdReportada`, `qtdRefugada`, `qtdRequisitada` e `qtdAprovadaCondicional`: quantidades acumuladas da ordem.
- `dtEmissao`, `dtInicio`, `dtTermino` e `dtOriginalTermino`: datas no formato observado `YYYY-MM-DD`.
- `estado`, `tipo` e `prioridade`: códigos numéricos cujo significado funcional ainda não foi fornecido.
- `operacoes`: operações associadas à ordem.

### Operações

Cada item de `operacoes` representa uma etapa produtiva. Entre os campos observados estão:

- identificação: `idOperacaoSfc`, `nrOrdemProducao`, `sequencia` e `codOperacao`;
- descrição e recursos: `descricaoOperacao`, `codGrupoMaquina`, `centroTrabalho`, `codItem` e `codRoteiro`;
- estado: `estado`, `primeiraOperacao`, `ultimaOperacao`, `operacaoFinalizada` e `operacaoControleQualidade`;
- quantidades e avanço: `qtdPrevista`, `qtdProduzida`, `qtdReportadaSfc`, `qtdAprovadaSfc`, `qtdRefugadaSfc`, `qtdRetrabalhoSfc`, `qtdRefugada`, `qtdAprovadaCondicional` e `percentualAvanco`;
- execução: `dtInicioReal`, `dtFimReal`, `horaInicioReal`, `horaFimReal` e `dtUltimoReporte`;
- detalhamento: `splits`.

### Splits

Cada operação possui uma lista `splits` com o detalhamento operacional. O exemplo inclui identificação do split, área e recursos de produção, tempos, quantidades, percentuais e indicadores de reporte.

Campos relevantes observados:

- identificação: `idOperacaoSfc`, `nrOrdemProducao`, `numSplit` e `codOperacao`;
- item e recursos: `codItemOp`, `codItemFabricado`, `codAreaProducao`, `codGrupoMaquina` e `centroTrabalho`;
- quantidades: `qtdPrevista`, `qtdReportada`, `qtdAprovada`, `qtdRefugada` e `qtdRetrabalho`;
- tempos: `tempoPadraoOperacao`, `tempoRealOperacao`, `tempoRealMaquina`, `tempoRealMod`, `segsInicioOperacao` e `segsFimOperacao`;
- estado: `estadoSplit`, `splitCritico`, `splitReportado`, `splitDescarregado` e `reportadoCp`;
- avanço: `percentualOperacao` e `percentualAvanco`;
- datas: `dtInicioOperacao` e `dtFimOperacao`.

## Observações do contrato

- Esta documentação descreve uma resposta observada e não substitui um contrato OpenAPI oficial.
- Campos vazios foram retornados como string vazia (`""`); datas de execução ainda não preenchidas foram retornadas como `null`.
- Os significados dos códigos numéricos de estado e tipo precisam ser confirmados com a regra de negócio antes de serem convertidos em enumerações no frontend.
- A cardinalidade observada foi `total: 1` e `hasNext: false` para a ordem `372562`.
