# Operadores

Consulta os operadores disponíveis para o usuário e a empresa informados.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/operadores?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `GET http://10.101.195.111:51080/api/fma/v1/operadores?companyId=1&codUsuario=mjocelio`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Corpo da requisição: não se aplica

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário. O valor fornecido foi `mjocelio`. |
| `pageSize` | integer | Não | A interface exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada observada. |

## Resposta observada

- Formato: JSON
- Status HTTP observado: `200 OK`
- Resposta integral: não fornecida; a captura exibe somente o início do payload
- Exemplo em `examples/`: não criado, para evitar registrar como completo um retorno truncado

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. O valor visível foi `1`. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. O valor visível foi `false`. |
| `items` | array | Lista de contêineres retornados pela consulta. |
| `items[].operadores` | array | Lista de operadores. A quantidade total de registros não pôde ser confirmada pela captura parcial. |

### Operadores

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `items[].operadores[].codAreaProduc` | string | Código da área de produção associada ao operador. Nos registros visíveis, também pode ser string vazia. |
| `items[].operadores[].codOperador` | string | Código do operador. Deve permanecer string para preservar zeros à esquerda. |
| `items[].operadores[].nomOperador` | string | Nome do operador. |
| `items[].operadores[].numTurno` | integer | Número do turno associado ao operador. |

## Pendências do contrato

- Obter e preservar o JSON integral da resposta em `examples/`.
- Confirmar a quantidade total de registros em `items[].operadores`.
- Confirmar o significado de `codAreaProduc` vazio e os valores possíveis de `numTurno`.
- Confirmar erros, filtros adicionais e comportamento de paginação.

## Observações do contrato

- Esta documentação descreve a requisição e a estrutura visível em uma captura parcial; não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `total: 1` representa o contêiner de primeiro nível observado e não deve ser interpretado como a quantidade de operadores, que está no array aninhado.
- A captura mostra códigos de operador com zeros à esquerda; esses valores não devem ser convertidos para número.
- Nomes e registros individuais não foram transcritos da captura parcial. Quando o JSON completo for fornecido, ele deverá ser preservado literalmente e validado antes de substituir esta pendência.
