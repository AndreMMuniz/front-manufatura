/** Version 2 reporting reasons. Legacy payloads remain immutable and use their original adapter. */
export interface MotivoReporte {
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
}

export const roundReportQuantity = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function validateReportReasons(rework: number, scrap: number, reasons: readonly MotivoReporte[]): string {
  const expected = [rework, scrap].map(roundReportQuantity);
  if (expected.some(value => !Number.isFinite(value) || value < 0)) return 'As quantidades devem ser finitas e não negativas.';
  if (new Set(reasons.map(reason => reason.codigo)).size !== reasons.length) return 'Há motivos duplicados no reporte.';
  for (const reason of reasons) {
    if (typeof reason.codigo !== 'string' || !reason.codigo.trim()
      || [reason.quantidadeRetrabalho, reason.quantidadeRefugo].some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      || roundReportQuantity(reason.quantidadeRetrabalho) + roundReportQuantity(reason.quantidadeRefugo) <= 0) {
      return 'Informe motivos com código e quantidades válidos.';
    }
  }
  for (const [index, field] of (['quantidadeRetrabalho', 'quantidadeRefugo'] as const).entries()) {
    const selected = reasons.filter(reason => roundReportQuantity(reason[field]) > 0);
    if (expected[index] > 0 && (selected.length !== 1 || roundReportQuantity(selected[0][field]) !== expected[index])) {
      return `Informe um motivo de ${index === 0 ? 'retrabalho' : 'refugo'} com a quantidade correspondente.`;
    }
    if (expected[index] === 0 && selected.length) return `Remova o motivo de ${index === 0 ? 'retrabalho' : 'refugo'}, pois a quantidade é zero.`;
  }
  return '';
}

export function setReportReason(reasons: readonly MotivoReporte[], field: 'quantidadeRetrabalho' | 'quantidadeRefugo', quantity: number, reason?: { codigo: string; descricao: string }): MotivoReporte[] {
  const next = reasons.map(item => ({ ...item, [field]: 0 })).filter(item => item.quantidadeRetrabalho > 0 || item.quantidadeRefugo > 0);
  const rounded = roundReportQuantity(quantity);
  if (!reason || rounded <= 0) return next;
  const existing = next.find(item => item.codigo === reason.codigo);
  if (existing) existing[field] = rounded;
  else next.push({ codigo: reason.codigo, descricao: reason.descricao, quantidadeRetrabalho: 0, quantidadeRefugo: 0, [field]: rounded });
  return next;
}
