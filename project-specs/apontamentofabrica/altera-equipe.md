# AlteraEquipe

Altera a composição de uma equipe existente.

## Requisição

- Método: `POST`
- Endpoint: `/api/fma/v1/alteraequipe?companyId={companyId}&codUsuario={codUsuario}`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Content-Type: `application/json`

```json
{
  "codEquipe": "AUT00039",
  "operadores": [
    "00016570",
    "00016580",
    "00022790",
    "00004611"
  ]
}
```

Os códigos devem permanecer strings para preservar zeros à esquerda.

## Resposta observada

A resposta usa o mesmo envelope de equipe já adaptado pelo gateway:

- `items[].equipeResultado[]` contém código, descrição, turno, mensagem e totais alterados;
- `items[].operadores[]` contém os códigos e nomes dos operadores após a alteração.

Exemplo de resultado:

```json
{
  "total": 1,
  "hasNext": false,
  "items": [
    {
      "equipeResultado": [
        {
          "codLider": "00016570",
          "qtdRemovidos": 0,
          "qtdAdicionados": 0,
          "mensagem": "Equipe alterada com sucesso",
          "codEquipe": "AUT00039",
          "desEquipe": "Equipe Automatica AUT00039",
          "numTurno": 1
        }
      ],
      "operadores": [
        {
          "codOperador": "00016570",
          "nomOperador": "JEFFERSON LIBRELON"
        }
      ]
    }
  ]
}
```

## Tratamento de falhas

- recusas funcionais devolvidas pelo Datasul são apresentadas ao usuário e não são enfileiradas;
- somente falhas transitórias de comunicação geram um comando `UPDATE_TEAM` na fila local;
- o reenvio usa a mesma rota interna `PUT /api/teams/:code`, que volta a chamar `AlteraEquipe`.
