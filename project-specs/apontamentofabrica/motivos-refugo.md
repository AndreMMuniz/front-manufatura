# MotivoRefugo

Consulta os motivos de refugo disponíveis para uso nos reportes de produção.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/motivosrefugo?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `GET http://10.101.195.111:51080/api/fma/v1/motivosrefugo?companyId=1&codUsuario=mjocelio`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Corpo da requisição: não se aplica

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário. O valor fornecido foi `mjocelio`. |
| `pageSize` | integer | Não | A interface exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada observada. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/motivos-refugo-company-1-response.json`](./examples/motivos-refugo-company-1-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. O valor observado foi `1`. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. O valor observado foi `false`. |
| `items` | array | Lista de contêineres retornados pela consulta. |
| `items[].motivosRefugo` | array | Lista dos motivos de refugo. A resposta fornecida contém 43 registros. |

### Motivos de refugo

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `items[].motivosRefugo[].desMotivoRefugo` | string | Descrição do motivo de refugo. |
| `items[].motivosRefugo[].codigoRejeicao` | integer | Código de rejeição associado ao motivo. |
| `items[].motivosRefugo[].refugoMaterial` | boolean | Indica se o motivo pode ser utilizado para refugo de material. |
| `items[].motivosRefugo[].refugoRetrabalho` | boolean | Indica se o motivo pode ser utilizado para retrabalho. |
| `items[].motivosRefugo[].codMotivoRefugo` | string | Código do motivo de refugo. Deve permanecer string para preservar zeros à esquerda. |

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- A resposta contém `total: 1`, `hasNext: false` e um único item com 43 registros em `motivosRefugo`.
- `codMotivoRefugo` é string e inclui valores com zeros à esquerda, além de códigos com três caracteres como `100` e `150`; não deve ser convertido para número.
- Os valores distintos observados em `codigoRejeicao` foram `1`, `2`, `3`, `8`, `9`, `10`, `11` e `13`; seu significado funcional precisa ser confirmado.
- Entre os 43 registros, 41 possuem `refugoMaterial: true` e 2 possuem `false`; 11 possuem `refugoRetrabalho: true` e 32 possuem `false`.
- Textos, capitalização, acentos, barras e abreviações foram preservados literalmente no exemplo integral.
