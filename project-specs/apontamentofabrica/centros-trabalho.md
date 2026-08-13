# Centros de trabalho

Consulta os centros de trabalho disponíveis para um usuário e uma área de produção de uma empresa.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/centrostrabalho?companyId={companyId}&codUsuario={codUsuario}&codAreaProduc={codAreaProduc}`
- Exemplo: `GET http://10.101.195.111:51080/api/fma/v1/centrostrabalho?companyId=1&codUsuario=mjocelio&codAreaProduc=4104`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Corpo da requisição: não se aplica

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário. O valor fornecido foi `mjocelio`. |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. O valor fornecido foi `4104`. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/centros-trabalho-company-1-area-4104-response.json`](./examples/centros-trabalho-company-1-area-4104-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista de contêineres retornados pela consulta. |
| `items[].centrosTrabalho` | array | Lista de centros de trabalho disponíveis. |
| `items[].centrosTrabalho[].codAreaProduc` | string | Código da área de produção associada ao centro de trabalho. |
| `items[].centrosTrabalho[].codCtrab` | string | Código do centro de trabalho. |
| `items[].centrosTrabalho[].desCtrab` | string | Descrição do centro de trabalho. |

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros foi preservado conforme a chamada recebida: `companyId`, `codUsuario` e `codAreaProduc`.
- Embora `codAreaProduc` contenha apenas dígitos no exemplo, o campo correspondente na resposta foi retornado como string.
- A resposta fornecida contém `total: 1` e `hasNext: false`; o único item agrupa 16 registros em `centrosTrabalho`.
