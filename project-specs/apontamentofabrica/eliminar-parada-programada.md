# EliminaParadaProgramada

Solicita a eliminação de uma parada programada para uma área de produção e um centro de trabalho.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/eliminaparadaprogramada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/eliminaparadaprogramada?companyId=1&codUsuario=mjocelio`
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

Exemplo integral: [`examples/eliminar-parada-programada-company-1-area-4104-ctrab-pre-006-02-request.json`](./examples/eliminar-parada-programada-company-1-area-4104-ctrab-pre-006-02-request.json)

```json
{
  "codAreaProduc": "4104",
  "codCtrab": "PRE-006-02",
  "numOmProgda": 1
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. |
| `numOmProgda` | integer | Não confirmado | Identificador numérico relacionado à OM programada. O valor enviado foi `1`; o significado funcional exato precisa ser confirmado. |

## Resposta

- Formato: não observado
- Status HTTP: não observado
- Corpo da resposta: não observado; a captura mostra a área de resposta vazia

## Pendências do contrato

- Confirmar se a combinação de `codAreaProduc`, `codCtrab` e `numOmProgda` identifica inequivocamente a parada programada.
- Confirmar se a eliminação é permanente, reversível ou apenas uma alteração de estado.
- Confirmar a resposta de sucesso, os status HTTP e os erros de validação.
- Confirmar o comportamento quando a parada programada não existe, já foi eliminada ou possui vínculos relacionados.
- Confirmar a idempotência ou o comportamento de chamadas repetidas.

## Observações do contrato

- Esta documentação descreve somente a requisição fornecida e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- O valor `numOmProgda: 1` foi preservado como número inteiro; não foi inferida sua relação com outros identificadores de parada.
- Como esta operação pode remover ou invalidar dados programados, não deve ser testada até que o identificador exato do alvo, a reversibilidade e o ambiente controlado estejam confirmados.
