# Ordens liberadas

Consulta as ordens de produção liberadas para um usuário, uma área de produção e um centro de trabalho de uma empresa.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/ordensliberadas?companyId={companyId}&codUsuario={codUsuario}&codAreaProduc={codAreaProduc}&codCtrab={codCtrab}`
- Exemplo: `GET http://10.101.195.111:51080/api/fma/v1/ordensliberadas?companyId=1&codUsuario=mjocelio&codAreaProduc=4104&codCtrab=PRE-006-02`
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

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/ordens-liberadas-company-1-area-4104-ctrab-pre-006-02-response.json`](./examples/ordens-liberadas-company-1-area-4104-ctrab-pre-006-02-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista de contêineres retornados pela consulta. |
| `items[].ordensLiberadas` | array | Lista de operações de ordens liberadas para o filtro informado. |

### Ordens liberadas

Cada registro de `ordensLiberadas` contém:

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `codItemOp` | string | Código do item da operação. |
| `desOperacao` | string | Descrição da operação. |
| `codRoteiro` | string | Código do roteiro. Foi retornado como string vazia nos registros fornecidos. |
| `opCodigo` | integer | Código da operação. |
| `nrOrdemProducao` | integer | Número da ordem de produção. |
| `estadoOrdem` | integer | Código do estado da ordem. |
| `itCodigo` | string | Código do item. |
| `numSplitOperac` | integer | Número do split da operação. |
| `indEstadoSplit` | integer | Indicador do estado do split. |
| `numOperacSfc` | integer | Número da operação no SFC. |
| `gmCodigo` | string | Código do grupo de máquina. |

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros foi preservado conforme a chamada recebida: `companyId`, `codUsuario`, `codAreaProduc` e `codCtrab`.
- Os significados funcionais de `estadoOrdem`, `indEstadoSplit` e dos demais códigos numéricos precisam ser confirmados com a regra de negócio.
- A consulta foi filtrada pelo centro de trabalho `PRE-006-02`, enquanto os registros retornaram `gmCodigo: "PRE-006"`.
- A resposta fornecida contém `total: 1` e `hasNext: false`; o único item agrupa 36 registros em `ordensLiberadas`.
