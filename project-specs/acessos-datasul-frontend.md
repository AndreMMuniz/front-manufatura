# Grupos de usuários e acessos Datasul para o frontend

Este documento consolida os grupos de usuários, os programas cadastrados no
Datasul e as APIs liberadas para o frontend do Plano de Controle e do
Apontamento de Chão de Fábrica.

## Plano de Controle CQ

### Grupos de usuários

- `FCQ`
- `FQ1`

### Programas e APIs

| Programa | Descrição no Datasul | APIs associadas |
| --- | --- | --- |
| `fcq-0001` | Apontamento Plano de Controle CQ | `Ordens`, `Roteiros`, `ResultExames` e `FinalizaRoteiros` |
| `fcq-0002` | Autoriza Roteiro Divergência Resultado | `AutorizaRoteiros` |

## Apontamento de Chão de Fábrica

### Grupo de programas para acesso

- `FM1`

### Programas e APIs

| Programa | Descrição no Datasul | API associada |
| --- | --- | --- |
| `fma-0001` | Inicia Ordem Frontend | `IniciaOrdem` |
| `fma-0002` | Inicia Ordem Batelada Frontend | `IniciaOrdemBatelada` |
| `fma-0003` | Reporte por Ordem Frontend | `ReporteOrdem` |
| `fma-0004` | Reporte Ordem por Batelada Frontend | `ReporteOrdemBatelada` |
| `fma-0005` | Iniciar Parada Frontend | `IniciaParada` |
| `fma-0006` | Incluir Parada Frontend | `IncluirParada` |
| `fma-0007` | Incluir Parada Programada Frontend | `ParadaProgramada` |
| `fma-0008` | Finaliza Parada Frontend | `FinalizaParada` |
| `fma-0009` | Elimina Parada Frontend | `EliminarParada` |
| `fma-0010` | Elimina Parada Programada Frontend | `EliminaParadaProgramada` |
| `fma-0011` | Motivo de Refugo Frontend | `MotivosRefugo` |
| `fma-0012` | Motivos de Parada Frontend | `MotivosParada` |
| `fma-0013` | Operadores Chão de Fábrica Frontend | `Operadores` |
| `fma-0014` | Gera Equipe Automática Frontend | `GeraEquipe` |

## Observação específica do Hub Cortaga

Conforme a informação recebida, somente os usuários `Mjocelio` e `Super`
estão nos grupos `MCQ`, `MQ1` e `MF1` no Hub Cortaga.

## Referências relacionadas

- [API do Plano de Controle CQ](./planodecontrole-api/README.md)
- [API de Apontamento de Fábrica](./apontamentofabrica/README.md)

