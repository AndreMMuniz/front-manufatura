# API do Plano de Controle CQ

Esta pasta reúne as chamadas da API utilizadas pela tela **Plano de Controle CQ**.

Os grupos de usuários e programas Datasul que controlam o acesso estão
consolidados em [Grupos de usuários e acessos Datasul para o frontend](../acessos-datasul-frontend.md).

## Endpoints documentados

| Recurso | Método | Endpoint | Documentação |
| --- | --- | --- | --- |
| Ordens de produção | `GET` | `/api/fcq/v1/ordens/{numeroOrdem}` | [ordens.md](./ordens.md) |
| Desenho do item | `GET` | `/api/fcq/v1/desenhoitem` | [desenho-item.md](./desenho-item.md) |
| Roteiros de inspeção | `POST` | `/api/fcq/v1/roteiros?companyid={companyId}` | [roteiros.md](./roteiros.md) |
| Resultados de exames | `PUT` | `/api/fcq/v1/resultexames?companyId={companyId}` | [result-exames.md](./result-exames.md) |
| Finalização de roteiros | `PUT` | `/api/fcq/v1/FinalizaRoteiros?companyId={companyId}` | [finaliza-roteiros.md](./finaliza-roteiros.md) |
| Roteiros pendentes de autorização | `GET` | `/api/fcq/v1/autorizacaoroteiros` | [autorizacao-roteiros.md](./autorizacao-roteiros.md) |
| Roteiro pendente por ficha | `GET` | `/api/fcq/v1/roteiropendente` | [autorizacao-roteiros.md](./autorizacao-roteiros.md) |
| Finalização autorizada de roteiros | `POST` | `/api/fcq/v1/finalizaroteirosautorizado?companyId={companyId}` | [autorizacao-roteiros.md](./autorizacao-roteiros.md) |

## Autenticação

As chamadas observadas utilizam HTTP Basic Auth. Credenciais não devem ser armazenadas nesta pasta nem versionadas no repositório.

## Exemplos

As respostas integrais observadas ficam em [`examples`](./examples/) para preservar o contrato retornado pela API e facilitar consultas futuras.
