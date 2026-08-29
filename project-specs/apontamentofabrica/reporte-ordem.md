# ReporteOrdem

Registra o reporte de uma única operação de ordem de produção. Diferentemente de
`ReporteOrdemBatelada`, os dados da ordem são enviados diretamente no corpo; este endpoint não
recebe o array `splits`.

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
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor observado foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário autenticado. |

### Corpo da requisição

Exemplo integral: [`examples/reporte-ordem-company-1-ordem-372577-request.json`](./examples/reporte-ordem-company-1-ordem-372577-request.json)

```json
{
  "codAreaProduc": "4104",
  "codCtrab": "PRE-006-02",
  "nrOrdemProducao": 372577,
  "opCodigo": 10,
  "numSplitOperac": 1,
  "qtdAprovada": 100,
  "qtdRetrabalho": 0,
  "qtdRefugada": 0,
  "dataInicioReporte": "2026-08-29",
  "horaInicioReporte": "07:18",
  "dataFimReporte": "2026-08-29",
  "horaFimReporte": "08:25",
  "codOperador": "00016570",
  "codEquipe": "",
  "codFerramenta": "",
  "codReferencia": "",
  "loteSerie": "",
  "dataValidadeLote": "",
  "codMotivoRefugo": "",
  "contaRefugo": "",
  "dataInicioSetup": "",
  "horaInicioSetup": "",
  "dataFimSetup": "",
  "horaFimSetup": "",
  "finalizarSplit": false
}
```

Os códigos de operador e motivo permanecem strings para preservar zeros à esquerda. Campos sem
valor foram observados como string vazia, não como `null`.

## Resposta de sucesso

Exemplo integral: [`examples/reporte-ordem-company-1-ordem-372577-response.json`](./examples/reporte-ordem-company-1-ordem-372577-response.json)

O retorno observado teve HTTP de sucesso e envelope `items[0].reporteOrdem`. O registro contém a
mensagem `Reporte gravado com sucesso` e ecoa a identidade, as quantidades, as datas e o estado de
finalização do split.

## Observações do contrato

- `ReporteOrdem` recebe uma única ordem no nível raiz do JSON.
- `ReporteOrdemBatelada` mantém contrato próprio com coleção de ordens.
- `codMotivoRefugo` é enviado vazio quando não há refugo e recebe o código selecionado quando
  `qtdRefugada` é maior que zero.
- O exemplo registra evidência observada e não substitui um contrato OpenAPI oficial.
- Como a operação altera quantidades, testes devem usar ordens autorizadas e ambiente controlado.
