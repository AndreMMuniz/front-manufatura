# EliminarParada

Solicita a eliminação de uma parada para uma área de produção e um centro de trabalho.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/eliminaparada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/eliminaparada?companyId=1&codUsuario=mjocelio`
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

Exemplo integral: [`examples/eliminar-parada-company-1-area-4104-ctrab-pre-006-02-request.json`](./examples/eliminar-parada-company-1-area-4104-ctrab-pre-006-02-request.json)

```json
{
  "codAreaProduc": "4104",
  "codCtrab": "pre-006-02",
  "codParada": "05",
  "dataInicioParada": "",
  "horaInicioParada": ""
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. O valor foi fornecido literalmente como `pre-006-02`, em minúsculas. |
| `codParada` | string | Não confirmado | Código da parada. Deve permanecer string para preservar o zero à esquerda no valor observado `"05"`. |
| `dataInicioParada` | string | Não confirmado | Data de início da parada. Foi enviada como string vazia. |
| `horaInicioParada` | string | Não confirmado | Hora de início da parada. Foi enviada como string vazia. |

## Resposta

- Formato: não observado
- Status HTTP: não observado
- Corpo da resposta: não observado; a captura mostra a chamada em andamento e a área de resposta vazia

## Pendências do contrato

- Confirmar como a combinação de área, centro de trabalho, código da parada e campos vazios seleciona inequivocamente o registro que será eliminado.
- Confirmar se a eliminação é permanente, reversível ou apenas uma alteração de estado.
- Confirmar a resposta de sucesso, os status HTTP e os erros de validação.
- Confirmar o comportamento quando a parada não existe, já foi eliminada ou possui reportes relacionados.
- Confirmar a idempotência ou o comportamento de chamadas repetidas.

## Observações do contrato

- Esta documentação descreve uma requisição fornecida e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `codCtrab` foi preservado como `pre-006-02`, embora outros exemplos do catálogo usem códigos de centro de trabalho em maiúsculas. A sensibilidade a maiúsculas e minúsculas não foi informada.
- `dataInicioParada` e `horaInicioParada` foram enviadas como string vazia (`""`), não como `null`; o significado desses valores para a seleção do registro não foi informado.
- Como esta operação pode remover ou invalidar dados, não deve ser testada até que o identificador exato do alvo, a reversibilidade e o ambiente controlado estejam confirmados.
