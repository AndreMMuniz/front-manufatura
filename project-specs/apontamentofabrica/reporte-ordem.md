# ReporteOrdem

Registra dados de reporte de operações de ordens de produção. Na requisição fornecida, o corpo reuniu quatro registros em `splits`.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/reporteordem?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/reporteordem?companyId=1&codUsuario=mjocelio`
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

Exemplo integral: [`examples/reporte-ordem-company-1-ordens-372569-372572-request.json`](./examples/reporte-ordem-company-1-ordens-372569-372572-request.json)

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
| `splits` | array | Não confirmado | Lista das ordens, operações, splits e quantidades enviadas no reporte. |
| `splits[].nrOrdemProducao` | integer | Não confirmado | Número da ordem de produção. |
| `splits[].opCodigo` | integer | Não confirmado | Código da operação. |
| `splits[].numSplitOperac` | integer | Não confirmado | Número do split da operação. |
| `splits[].qtdAprovada` | number | Não confirmado | Quantidade aprovada. |
| `splits[].qtdRetrabalho` | number | Não confirmado | Quantidade destinada a retrabalho. |
| `splits[].qtdRefugada` | number | Não confirmado | Quantidade refugada. |
| `splits[].codMotivoRefugo` | string | Não confirmado | Código do motivo de refugo ou retrabalho. Foi enviado como `"05"` ou string vazia, conforme o registro. |

## Resposta

- Formato: não observado
- Status HTTP: não informado na evidência recebida
- Corpo da resposta: não observado; a captura fornecida mostra somente a configuração da requisição

> Quando o retorno for disponibilizado, ele deverá ser preservado integralmente em `examples/` e sua estrutura documentada nesta seção.

## Observações do contrato

- Esta documentação descreve somente a requisição fornecida e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida, incluindo `qtdRefugada`.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `codOperador` deve ser tratado como string, pois o valor observado possui zeros à esquerda.
- Campos sem valor foram enviados como string vazia (`""`), não como `null`.
- Embora o endpoint observado seja `ReporteOrdem`, no singular, o corpo fornecido contém quatro registros em `splits`; o significado e a cardinalidade aceitos precisam ser confirmados com o contrato oficial.
- Não foi fornecida resposta deste endpoint. Portanto, regras observadas em `ReporteOrdemBatelada` não foram assumidas automaticamente para `ReporteOrdem`.
- O contrato de sucesso, os erros, a atomicidade dos registros enviados e o comportamento em repetição não foram informados.
- Como esta operação altera quantidades e o estado de ordens, chamadas de teste devem usar ordens autorizadas e um ambiente controlado.
