# ReporteOrdemBatelada

Reporta, em uma única batelada, as quantidades produzidas, retrabalhadas e refugadas de várias ordens de produção.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/reporteordembatelada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/reporteordembatelada?companyId=1&codUsuario=mjocelio`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Content-Type: `application/json`

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário. O valor fornecido foi `mjocelio`. |
| `pageSize` | integer | Não | A interface exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada observada. |

### Corpo da requisição

Exemplo integral: [`examples/reporte-ordem-batelada-company-1-ordens-372569-372572-request.json`](./examples/reporte-ordem-batelada-company-1-ordens-372569-372572-request.json)

```json
{
  "codAreaProduc": "4113",
  "codCtrab": "LASER-01-01",
  "dataInicioReporte": "2026-08-14",
  "horaInicioReporte": "07:18",
  "dataFimReporte": "2026-08-14",
  "horaFimReporte": "08:25",
  "codOperador": "00016570",
  "codEquipe": "",
  "codFerramenta": "",
  "dataInicioSetup": "",
  "horaInicioSetup": "",
  "dataFimSetup": "",
  "horaFimSetup": "",
  "finalizarSplit": false,
  "splits": [
    {
      "nrOrdemProducao": 372569,
      "opCodigo": 20,
      "numSplitOperac": 1,
      "qtdAprovada": 10,
      "qtdRetrabalho": 1,
      "qtdRefugada": 2,
      "codMotivoRefugo": "05"
    },
    {
      "nrOrdemProducao": 372570,
      "opCodigo": 20,
      "numSplitOperac": 1,
      "qtdAprovada": 2,
      "qtdRetrabalho": 0,
      "qtdRefugada": 0,
      "codMotivoRefugo": ""
    },
    {
      "nrOrdemProducao": 372571,
      "opCodigo": 20,
      "numSplitOperac": 1,
      "qtdAprovada": 40,
      "qtdRetrabalho": 2,
      "qtdRefugada": 1,
      "codMotivoRefugo": "05"
    },
    {
      "nrOrdemProducao": 372572,
      "opCodigo": 10,
      "numSplitOperac": 1,
      "qtdAprovada": 10,
      "qtdRetrabalho": 1,
      "qtdRefugada": 0,
      "codMotivoRefugo": ""
    }
  ]
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. |
| `dataInicioReporte` | string | Não confirmado | Data de início do reporte, no formato observado `YYYY-MM-DD`. |
| `horaInicioReporte` | string | Não confirmado | Hora de início do reporte, no formato observado `HH:mm`. |
| `dataFimReporte` | string | Não confirmado | Data de fim do reporte, no formato observado `YYYY-MM-DD`. |
| `horaFimReporte` | string | Não confirmado | Hora de fim do reporte, no formato observado `HH:mm`. |
| `codOperador` | string | Não confirmado | Código do operador. Deve permanecer string para preservar zeros à esquerda. |
| `codEquipe` | string | Não confirmado | Código da equipe. Foi enviado como string vazia. |
| `codFerramenta` | string | Não confirmado | Código da ferramenta. Foi enviado como string vazia. |
| `dataInicioSetup` | string | Não confirmado | Data de início do setup. Foi enviada como string vazia. |
| `horaInicioSetup` | string | Não confirmado | Hora de início do setup. Foi enviada como string vazia. |
| `dataFimSetup` | string | Não confirmado | Data de fim do setup. Foi enviada como string vazia. |
| `horaFimSetup` | string | Não confirmado | Hora de fim do setup. Foi enviada como string vazia. |
| `finalizarSplit` | boolean | Não confirmado | Indica se os splits devem ser finalizados. O valor enviado foi `false`. |
| `splits` | array | Não confirmado | Lista das ordens, operações, splits e quantidades reportadas em batelada. |
| `splits[].nrOrdemProducao` | integer | Não confirmado | Número da ordem de produção. |
| `splits[].opCodigo` | integer | Não confirmado | Código da operação. |
| `splits[].numSplitOperac` | integer | Não confirmado | Número do split da operação. |
| `splits[].qtdAprovada` | number | Não confirmado | Quantidade aprovada. |
| `splits[].qtdRetrabalho` | number | Não confirmado | Quantidade destinada a retrabalho. |
| `splits[].qtdRefugada` | number | Não confirmado | Quantidade refugada. |
| `splits[].codMotivoRefugo` | string | Condicional, conforme erro observado | Código do motivo de refugo ou retrabalho. A resposta informou que é obrigatório quando `qtdRefugada > 0` ou `qtdRetrabalho > 0`. |

## Resposta fornecida

- Formato: JSON
- Resultado observado: erro
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/reporte-ordem-batelada-company-1-ordens-372569-372572-response-error.json`](./examples/reporte-ordem-batelada-company-1-ordens-372569-372572-response-error.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `detailedMessage` | string | Descrição detalhada do primeiro erro retornado. |
| `code` | string | Código do primeiro erro. O valor observado foi `"1"`. |
| `details` | array | Lista dos demais erros retornados para a batelada. |
| `message` | string | Mensagem do primeiro erro retornado. |
| `type` | string | Tipo do resultado. O valor observado foi `"error"`. |

### Erros em `details`

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `details[].detailedMessage` | string | Descrição detalhada do erro da ordem e operação. |
| `details[].code` | string | Código sequencial do erro. Os valores observados foram `"2"`, `"3"` e `"4"`. |
| `details[].message` | string | Mensagem do erro, igual a `detailedMessage` nos registros observados. |
| `details[].type` | string | Tipo do detalhe. O valor observado foi `"error"`. |

## Erros observados

- Ordens `372569`, `372570` e `372571`, operação `20`: o split não estava iniciado (`ind-estado-split=3`); a própria API orientou usar `IniciaOrdem` ou `IniciarOrdemBatelada` antes.
- Ordem `372572`, operação `10`: `codMotivoRefugo` foi exigido porque `qtdRetrabalho` era maior que zero, mesmo com `qtdRefugada` igual a zero.
- O erro da ordem `372569` aparece nos campos do primeiro nível. Os erros das ordens `372570`, `372571` e `372572` aparecem em `details`.

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida, incluindo `qtdRefugada`.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `codOperador` deve ser tratado como string, pois o valor observado possui zeros à esquerda.
- Campos sem valor foram enviados como string vazia (`""`), não como `null`.
- A resposta retornou todos os quatro problemas encontrados, em vez de somente o primeiro.
- O status HTTP, o contrato de sucesso, a atomicidade da batelada e o comportamento em repetição não foram informados.
- Como esta operação altera quantidades e o estado de várias ordens, chamadas de teste devem usar ordens autorizadas e um ambiente controlado.
