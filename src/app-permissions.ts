export const APP_PERMISSIONS = {
  mainMenu: 'MENU_PRINCIPAL',
  qualityControl: 'PLANO_CONTROLE_CQ',
  divergentRouteAuthorization: 'AUTORIZACAO_ROTEIRO_DIVERGENCIA',
  operationReporting: 'REPORTE_ORDEM',
  batchReporting: 'REPORTE_BATELADA',
  stoppages: 'REPORTE_PARADAS',
} as const;

export type AppPermission = typeof APP_PERMISSIONS[keyof typeof APP_PERMISSIONS];

export const DATASUL_SECURITY_PROGRAMS = [
  { program: 'fcq-0001', permissions: [APP_PERMISSIONS.qualityControl] },
  { program: 'fcq-0002', permissions: [APP_PERMISSIONS.divergentRouteAuthorization] },
  { program: 'fma-0001', permissions: [APP_PERMISSIONS.operationReporting] },
  { program: 'fma-0002', permissions: [APP_PERMISSIONS.batchReporting] },
  { program: 'fma-0003', permissions: [APP_PERMISSIONS.operationReporting] },
  { program: 'fma-0004', permissions: [APP_PERMISSIONS.batchReporting] },
  { program: 'fma-0005', permissions: [APP_PERMISSIONS.stoppages] },
  { program: 'fma-0006', permissions: [APP_PERMISSIONS.stoppages] },
  { program: 'fma-0007', permissions: [APP_PERMISSIONS.stoppages] },
  { program: 'fma-0008', permissions: [APP_PERMISSIONS.stoppages] },
  { program: 'fma-0009', permissions: [APP_PERMISSIONS.stoppages] },
  { program: 'fma-0010', permissions: [APP_PERMISSIONS.stoppages] },
  { program: 'fma-0011', permissions: [] },
  { program: 'fma-0012', permissions: [] },
  { program: 'fma-0013', permissions: [] },
  { program: 'fma-0014', permissions: [] },
] as const;

export type DatasulSecurityProgram = typeof DATASUL_SECURITY_PROGRAMS[number]['program'];
