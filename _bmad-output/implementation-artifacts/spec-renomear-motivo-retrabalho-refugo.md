---
title: 'Renomear motivo de retrabalho e refugo'
type: 'bugfix'
created: '2026-07-28'
status: 'done'
route: 'one-shot'
---

# Renomear motivo de retrabalho e refugo

## Intent

**Problem:** O campo de motivo na edição do reporte em batelada exibia “Motivo da Ordem” acompanhado do número da ordem.

**Approach:** Usar o rótulo fixo “Motivo do Retrabalho/Refugo” e cobrir a apresentação sem o número da ordem com um teste de componente.

## Suggested Review Order

- O campo apresenta o novo texto fixo solicitado.
  [`reporte-batelada-slide.html:51`](../../src/app/features/reporta-batelada/components/reporte-batelada-slide/reporte-batelada-slide.html#L51)

- O teste protege o rótulo e a ausência do formato anterior.
  [`reporte-batelada-slide.spec.ts:60`](../../src/app/features/reporta-batelada/components/reporte-batelada-slide/reporte-batelada-slide.spec.ts#L60)
