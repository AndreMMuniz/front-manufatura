# API do Plano de Controle CQ

Esta pasta reúne as chamadas da API utilizadas pela tela **Plano de Controle CQ**.

## Endpoints documentados

| Recurso | Método | Endpoint | Documentação |
| --- | --- | --- | --- |
| Roteiros de inspeção | `POST` | `/api/fcq/v1/roteiros?companyid={companyId}` | [roteiros.md](./roteiros.md) |
| Resultados de exames | `PUT` | `/api/fcq/v1/resultexames?companyId={companyId}` | [result-exames.md](./result-exames.md) |
| Finalização de roteiros | `PUT` | `/api/fcq/v1/FinalizaRoteiros?companyId={companyId}` | [finaliza-roteiros.md](./finaliza-roteiros.md) |

## Autenticação

As chamadas observadas utilizam HTTP Basic Auth. Credenciais não devem ser armazenadas nesta pasta nem versionadas no repositório.

## Exemplos

As respostas integrais observadas ficam em [`examples`](./examples/) para preservar o contrato retornado pela API e facilitar consultas futuras.
