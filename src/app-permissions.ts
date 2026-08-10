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
  { program: 'fcq-0001', permission: APP_PERMISSIONS.qualityControl },
  { program: 'fcq-0002', permission: APP_PERMISSIONS.divergentRouteAuthorization },
  { program: 'fma-0001', permission: APP_PERMISSIONS.operationReporting },
  { program: 'fma-0002', permission: APP_PERMISSIONS.batchReporting },
  { program: 'fma-0003', permission: APP_PERMISSIONS.stoppages },
] as const;

export type DatasulSecurityProgram = typeof DATASUL_SECURITY_PROGRAMS[number]['program'];

