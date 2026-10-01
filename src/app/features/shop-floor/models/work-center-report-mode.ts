import { WorkCenter } from './work-center';

export const WORK_CENTER_REPORT_MODE_ERROR =
  'O Centro de Trabalho não informou uma modalidade válida de reporte (Operador ou Equipe). Consulte novamente a Área ou contate o responsável pela API.';

export function workCenterResponsibleType(
  center: WorkCenter | null | undefined,
): 'OPERADOR' | 'EQUIPE' | null {
  if (center?.indReporteMod === 2) return 'OPERADOR';
  if (center?.indReporteMod === 3) return 'EQUIPE';
  return null;
}
