# Resultados de exames

Registra o resultado de um componente de exame associado a uma ficha de inspeção.

> Diagnóstico relacionado: [incidente de resultado tipo 3 enviado como número](./incidents/2026-08-14-plano-controle-tipo-3-laudo.md).

## Requisição

- Método: `PUT`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/resultexames?companyId={companyId}`
- Exemplo: `PUT http://10.101.195.111:51080/api/fcq/v1/resultexames?companyId=1`
- Autenticação: HTTP Basic Auth
- Content-Type: `application/json`
- Efeito: gravação de resultado de exame

> As credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Sim | Identificador da empresa. O valor observado foi `1`. A capitalização difere do parâmetro `companyid` observado na chamada de Roteiros. |

### Corpo da requisição

O corpo usa uma única representação de resultado, determinada por `tipoResultado` retornado anteriormente pelo endpoint de roteiros.

#### Tipo 2 — opção tabelada

```json
{
  "nrFicha": 64378,
  "codExame": 1845,
  "codComponente": 3,
  "nrTabela": 8,
  "seqOpcao": 1,
  "codUsuario": "Mjocelio"
}
```

#### Tipo 3 — laudo textual

Evidência confirmada em 2026-08-14: o Datasul rejeitou a ausência de `laudo` com a mensagem `Laudo e obrigatório para tipo-result=3` e aceitou HTTP 200 quando recebeu `"laudo": "0"`. O teste de confirmação ainda continha `nrTabela` e `seqOpcao` residuais; o exemplo abaixo representa o corpo canônico adotado pelo cliente, sem misturar representações de resultado.

```json
{
  "nrFicha": 64391,
  "codExame": 2000,
  "codComponente": 10,
  "laudo": "0",
  "codUsuario": "Mjocelio"
}
```

#### Tipo 4 — faixa medida

```json
{
  "nrFicha": 64396,
  "codExame": 164,
  "codComponente": 10,
  "resultado": 347,
  "resultadoMax": 347.5,
  "codUsuario": "Mjocelio"
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `nrFicha` | integer | Sim | Número da ficha de inspeção. |
| `codExame` | integer | Sim | Código do exame. |
| `codComponente` | integer | Sim | Código do componente avaliado. |
| `nrTabela` | integer | Condicional | Número da tabela de opções; usado em `tipoResultado: 2`. |
| `seqOpcao` | integer | Condicional | Sequência da opção; usado em `tipoResultado: 2`. |
| `laudo` | string | Condicional | Laudo textual obrigatório em `tipoResultado: 3`. O texto `"0"` foi aceito. |
| `resultado` | number | Condicional | Medição numérica simples em `tipoResultado: 1`; valor mínimo medido em `tipoResultado: 4`. |
| `resultadoMax` | number | Condicional | Valor máximo medido, obrigatório junto com `resultado` em `tipoResultado: 4`. |
| `codUsuario` | string | Sim | Código do usuário responsável pelo registro. O valor observado foi `Mjocelio`. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/result-exames-ficha-64378-componente-3-response.json`](./examples/result-exames-ficha-64378-componente-3-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista dos resultados gravados ou retornados pela operação. |

### Resultado do componente

Cada item de `items` contém:

- identificação: `nrFicha`, `codExame`, `codComponente`, `nrTabela`, `seqComp`, `numeroTeste` e `codItem`;
- resultado: `resultado`, `resultadoMinDefinido`, `resultadoMaxDefinido`, `resultadoMax`, `tipoResultado` e `dentroFaixa`;
- auditoria e data: `codResponsavel` e `dtResultado`;
- progresso: `componentesSalvos` e `componentesTotal`;
- informações complementares: `observacao` e `laudo`.

## Observações do contrato

- `resultadoMin` e `resultadoMax` no roteiro são os limites definidos da característica. No PUT, o primeiro valor medido usa `resultado` e, para `tipoResultado: 4`, o segundo usa `resultadoMax`.
- Para `tipoResultado: 3`, `resultadoMin: 0.0`, `resultadoMax: 0.0`, `nrTabela: 0` e `referenciaTecnica` vazia não significam que o resultado esperado seja zero; o PUT exige `laudo`.
- O cliente deve enviar somente a representação correspondente ao tipo: tabela, laudo ou número.
- Em `tipoResultado: 4`, o Datasul pode devolver `dentroFaixa: null` mesmo após gravar os dois valores. Esse retorno representa classificação não informada e não falha de integração.
- A exclusividade acima é uma regra do corpo da requisição. O recibo pode trazer
  simultaneamente campos auxiliares como `resultado`, `nrTabela` e `laudo`, e não
  precisa repetir `seqOpcao`; o exemplo real versionado demonstra essa forma.
  Consumidores devem validar envelope, identidade, totais e `dentroFaixa`, sem
  reaplicar ao recibo a união exclusiva usada para montar o PUT.
- Esta é uma operação de escrita. Repetições, tentativas automáticas e sincronização offline precisam considerar a idempotência efetiva do endpoint, que não foi informada.
- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- Os significados adotados são: 1 para resultado numérico simples, 2 para opção tabelada, 3 para laudo textual e 4 para faixa medida (mínimo e máximo).
- Na resposta fornecida, `dentroFaixa` foi `false`, embora a opção selecionada tenha sido `seqOpcao: 1`; a documentação preserva os valores recebidos sem inferir aprovação ou reprovação.
- A cardinalidade fornecida foi `total: 1` e `hasNext: false`, com `componentesSalvos: 6` de `componentesTotal: 6`.
