# Abrir apontamento

Consulta os dados necessários para abrir o apontamento de uma operação específica de uma ordem de produção.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/abrirapontamento?companyId={companyId}&codUsuario={codUsuario}&codAreaProduc={codAreaProduc}&codCtrab={codCtrab}&nrOrdemProducao={nrOrdemProducao}&opCodigo={opCodigo}&numSplitOperac={numSplitOperac}`
- Exemplo: `GET http://10.101.195.111:51080/api/fma/v1/abrirapontamento?companyId=1&codUsuario=mjocelio&codAreaProduc=4104&codCtrab=PRE-006-02&nrOrdemProducao=372562&opCodigo=10&numSplitOperac=1`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Corpo da requisição: não se aplica

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário. O valor fornecido foi `mjocelio`. |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. O valor fornecido foi `4104`. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. O valor fornecido foi `PRE-006-02`. |
| `nrOrdemProducao` | integer | Não confirmado | Número da ordem de produção. O valor fornecido foi `372562`. |
| `opCodigo` | integer | Não confirmado | Código da operação. O valor fornecido foi `10`. |
| `numSplitOperac` | integer | Não confirmado | Número do split da operação. O valor fornecido foi `1`. |
| `pageSize` | integer | Não | A interface exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada observada. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/abrir-apontamento-company-1-area-4104-ctrab-pre-006-02-ordem-372562-op-10-split-1-response.json`](./examples/abrir-apontamento-company-1-area-4104-ctrab-pre-006-02-ordem-372562-op-10-split-1-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista de contêineres retornados pela consulta. |
| `items[].dadosApontamento` | array | Lista com os dados necessários para abrir o apontamento. |

### Dados do apontamento

Cada registro de `dadosApontamento` contém:

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `desOperacao` | string | Descrição da operação. |
| `qtdOrdem` | number | Quantidade total da ordem. |
| `qtdAprovada` | number | Quantidade aprovada. |
| `opCodigo` | integer | Código da operação. |
| `itCodigo` | string | Código do item. |
| `desGrupoMaquina` | string | Descrição do grupo de máquina. |
| `desModelTurno` | string | Descrição do modelo de turno. |
| `numSplitOperac` | integer | Número do split da operação. |
| `codOperadorAlocado` | string | Código do operador já vinculado ao split iniciado. |
| `codEquipeAlocado` | string | Código alocado retornado pela abertura; no modo operador pode conter o responsável quando `codOperadorAlocado` vier vazio. |
| `indSplitJaIniciado` | boolean | Indica que o split já foi iniciado e deve ser aberto diretamente para reporte. |
| `indReporteMod` | integer | Indicador de reporte de mão de obra. |
| `qtdRefugo` | number | Quantidade refugada. |
| `qtdSaldo` | number | Quantidade restante para apontamento. |
| `nrOrdemProducao` | integer | Número da ordem de produção. |
| `un` | string | Unidade de medida do item. |
| `codCtrab` | string | Código do centro de trabalho. |
| `codModelTurno` | string | Código do modelo de turno. |
| `descItem` | string | Descrição do item. |
| `codGrupoMaquina` | string | Código do grupo de máquina. |
| `qtdRetrabalho` | number | Quantidade destinada a retrabalho. |
| `numOperacSfc` | integer | Número da operação no SFC. |
| `desCtrab` | string | Descrição do centro de trabalho. |

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros foi preservado conforme a chamada recebida: `companyId`, `codUsuario`, `codAreaProduc`, `codCtrab`, `nrOrdemProducao`, `opCodigo` e `numSplitOperac`.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- Os significados funcionais de `indReporteMod` e dos demais códigos precisam ser confirmados com a regra de negócio.
- Os textos retornados foram preservados literalmente, incluindo a descrição de turno `SEG ~ SÁB 2T - SABÁDO SIM`.
- Quando `indSplitJaIniciado` for `true`, o responsável alocado deve ser preservado e a interface não deve solicitar uma nova seleção antes do reporte.
- A resposta fornecida contém `total: 1` e `hasNext: false`; o único item agrupa um registro em `dadosApontamento`.
