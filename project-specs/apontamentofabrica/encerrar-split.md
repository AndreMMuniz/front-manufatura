# EncerrarSplit

Encerra um split de uma operação de ordem de produção. Se esse for o último split aberto, a operação também é finalizada.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/encerrasplit?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/encerrasplit?companyId=1&codUsuario=mjocelio`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Content-Type: `application/json`

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Sim na chamada observada | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Sim na chamada observada | Código do usuário Datasul. O valor fornecido foi `mjocelio`. |
| `pageSize` | integer | Não | A interface exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada. |

### Corpo

Exemplo integral: [`examples/encerrar-split-company-1-ordem-372561-op-10-split-1-request.json`](./examples/encerrar-split-company-1-ordem-372561-op-10-split-1-request.json)

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `codAreaProduc` | string | Código da área de produção. |
| `codCtrab` | string | Código do centro de trabalho. |
| `nrOrdemProducao` | integer | Número da ordem de produção. |
| `opCodigo` | integer | Código da operação. |
| `numSplitOperac` | integer | Número do split da operação. |

## Resposta

- Status observado: `200 OK`
- Exemplo integral: [`examples/encerrar-split-company-1-ordem-372561-op-10-split-1-response.json`](./examples/encerrar-split-company-1-ordem-372561-op-10-split-1-response.json)

O resultado é devolvido em `items[0].splitResultado`. `operacaoFechada` informa se a operação inteira foi finalizada; `false` pode ser um resultado válido quando outros splits permanecem abertos. A identidade formada por `nrOrdemProducao`, `opCodigo` e `numSplitOperac` deve corresponder à requisição.

## Limitações da evidência

- A documentação reflete uma única chamada observada e não substitui um contrato OpenAPI oficial.
- Não foram fornecidos exemplos de `operacaoFechada: false`, repetição, autenticação inválida ou erros HTTP.
- O significado completo de `estadoSplit: 5` e a lista dos demais estados não foram informados.
- Como a chamada altera o estado produtivo, testes contra o Datasul devem usar ordens autorizadas e ambiente controlado.
