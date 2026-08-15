import type { BrowserContext, Route } from '@playwright/test';

type Team = {
  codigo: string;
  descricao: string;
  turno: string;
  operadores: Array<{ codigo: string; nome: string }>;
};

const OPERATORS = [
  { code: '001', name: 'Jose Ribeiro Neto', role: 'Operador', active: true },
  { code: '002', name: 'Almir Rogerio Bento', role: 'Operador', active: true },
  { code: '003', name: 'Ana Silva', role: 'Operador', active: true },
  { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
];

const AREAS = [
  { code: '4001', description: 'Produção' },
  { code: '4002', description: 'Qualidade' },
];

const WORK_CENTERS = [
  {
    code: 'CT-EXT-01', description: 'Extrusao Linha 01', areaCode: '4001',
    area: 'Producao', machineGroup: 'Extrusoras', establishment: '101', active: true,
  },
  {
    code: 'CT-CQ-01', description: 'Controle de Qualidade', areaCode: '4002',
    area: 'Qualidade', machineGroup: 'Qualidade', establishment: '101', active: true,
  },
];

const ORDERS = [
  {
    id: '450001|PERFIL-100 / OP-10458|10|01', ordem: '450001',
    itemOp: 'PERFIL-100 / OP-10458', operacao: '10', split: '01',
    areaCode: '4001', workCenterCode: 'CT-EXT-01',
  },
  {
    id: '450002|PERFIL-200 / OP-10459|20|01', ordem: '450002',
    itemOp: 'PERFIL-200 / OP-10459', operacao: '20', split: '01',
    areaCode: '4001', workCenterCode: 'CT-EXT-01',
  },
];

const OPERATION_DETAILS: Record<string, object> = {
  '450001': {
    ordem: '450001', op: '10', split: '01', item: 'PERFIL-100', descricao: 'Perfil 100',
    unidade: 'PC', roteiro: '10 - Extrusão', quantidadeOrdem: 500, quantidadeSaldo: 320,
    linha: 'Extrusão', ct: 'CT-EXT-01', grupoMaquina: 'Extrusoras', operador: '', equipe: '',
    turno: '1º Turno',
  },
  '450002': {
    ordem: '450002', op: '20', split: '01', item: 'PERFIL-200', descricao: 'Perfil 200',
    unidade: 'PC', roteiro: '20 - Acabamento', quantidadeOrdem: 400, quantidadeSaldo: 250,
    linha: 'Extrusão', ct: 'CT-EXT-01', grupoMaquina: 'Extrusoras', operador: '', equipe: '',
    turno: '1º Turno',
  },
};

const QUALITY_ORDER = {
  total: 1,
  hasNext: false,
  items: [{
    'ds-ordem-producao': {
      ordem: [{
        nrOrdemProducao: 325571,
        codItem: '30907',
        operacoes: [
          { codOperacao: 10, descricaoOperacao: 'Cortar chapa', codItem: '30907', splits: [{ numSplit: 1 }] },
          { codOperacao: 20, descricaoOperacao: 'Dobrar chapa', codItem: '30907', splits: [{ numSplit: 1 }] },
          { codOperacao: 30, descricaoOperacao: 'Soldar', codItem: '30907', splits: [{ numSplit: 1 }] },
        ],
      }],
    },
  }],
};

const QUALITY_ROUTE = {
  total: 1,
  hasNext: false,
  items: [{
    nrFicha: 475956,
    'ds-roteiro': {
      exames: [{
        codExame: 500517,
        descricao: 'Filmes e Mangueiras',
        versao: 1,
        frequencia: 2,
        amostra: 1,
        nivel: 1,
        nqa: 0,
        responsavel: 'BUENO',
        observacao: 'Visual 100% do corte !',
        componentes: [
          qualityComponent(10, 'Cota 488,0 +/- 3,0mm', 485, 491, 'Régua'),
          qualityComponent(20, 'Cota 255,0 +/- 0,5mm', 254.5, 255.5, 'Paquímetro'),
          qualityComponent(30, 'Cota 380,0 +/- 5,0mm', 375, 385, 'Régua'),
        ],
      }],
    },
  }],
};

export async function mockE2eBackend(context: BrowserContext): Promise<void> {
  const teams = new Map<string, Team>();

  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/auth/login' && request.method() === 'POST') {
      const body = request.postDataJSON() as { login?: unknown };
      const login = typeof body.login === 'string' ? body.login.trim() : 'operador';
      const tokenExpiresAt = new Date(Date.now() + 28_800_000).toISOString();
      const permissoes = login.toLocaleLowerCase('pt-BR') === 'mjocelio'
        ? ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ', 'REPORTE_ORDEM']
        : [
            'MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ', 'AUTORIZACAO_ROTEIRO_DIVERGENCIA',
            'REPORTE_ORDEM', 'REPORTE_BATELADA', 'REPORTE_PARADAS',
          ];
      await json(route, {
        token: 'e2e-memory-token', tokenExpiresAt, offlineSessionExpiresAt: tokenExpiresAt,
        usuario: {
          id: `E2E-${login}`, nome: 'Operador E2E', login,
          permissoes,
        },
      });
      return;
    }

    if (path === '/api/quality-control/orders/325571' && request.method() === 'GET') {
      await json(route, QUALITY_ORDER);
      return;
    }
    if (path === '/api/quality-control/routes' && request.method() === 'POST') {
      await json(route, QUALITY_ROUTE);
      return;
    }
    if (path === '/api/production-areas' && request.method() === 'GET') {
      await json(route, AREAS);
      return;
    }
    if (path === '/api/work-centers' && request.method() === 'GET') {
      const areaCode = url.searchParams.get('areaCode');
      const term = normalize(url.searchParams.get('term') ?? '');
      await json(route, WORK_CENTERS.filter(center =>
        (!areaCode || center.areaCode === areaCode)
        && (!term || normalize(`${center.code} ${center.description} ${center.area}`).includes(term))));
      return;
    }
    if (path === '/api/operators' && request.method() === 'GET') {
      const term = normalize(url.searchParams.get('term') ?? '');
      await json(route, OPERATORS.filter(operator =>
        operator.active && (!term || normalize(`${operator.code} ${operator.name}`).includes(term))));
      return;
    }
    if (path === '/api/operational-responsibles' && request.method() === 'GET') {
      const teamOptions = [...teams.values()].map(team => ({
        tipo: 'EQUIPE', codigo: team.codigo, nome: team.descricao,
      }));
      await json(route, [
        { tipo: 'OPERADOR', codigo: '001', nome: 'Jose Ribeiro Neto' },
        { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
        ...teamOptions,
      ]);
      return;
    }
    if (path === '/api/production-orders' && request.method() === 'GET') {
      await json(route, url.searchParams.get('areaCode') === '4001' ? ORDERS : []);
      return;
    }
    const operationMatch = /^\/api\/production-orders\/(\d+)\/operations\/[^/]+$/.exec(path);
    if (operationMatch && request.method() === 'GET') {
      const details = OPERATION_DETAILS[operationMatch[1]];
      await json(route, details ?? { code: 'not-found' }, details ? 200 : 404);
      return;
    }
    if (path === '/api/stop-reasons' && request.method() === 'GET') {
      await json(route, [
        { id: 1, code: '01', description: 'Setup' },
        { id: 2, code: '02', description: 'Manutenção' },
      ]);
      return;
    }
    if (path === '/api/scrap-reasons' && request.method() === 'GET') {
      await json(route, [{ codigo: '05', descricao: 'Borra' }]);
      return;
    }
    if (path === '/api/teams' && request.method() === 'GET') {
      await json(route, [...teams.values()]);
      return;
    }
    if (path === '/api/teams' && request.method() === 'POST') {
      const team = teamFrom(request.postDataJSON(), teams);
      teams.set(team.codigo, team);
      await json(route, team, 201);
      return;
    }
    const teamMatch = /^\/api\/teams\/([^/]+)$/.exec(path);
    if (teamMatch) {
      const code = decodeURIComponent(teamMatch[1]).trim().toUpperCase();
      if (request.method() === 'GET') {
        const team = teams.get(code);
        await json(route, team ?? { code: 'not-found' }, team ? 200 : 404);
        return;
      }
      if (request.method() === 'PUT') {
        const team = teamFrom({ ...teams.get(code), ...request.postDataJSON(), codigo: code }, teams);
        teams.set(code, team);
        await json(route, team);
        return;
      }
    }

    await route.fallback();
  });
}

function qualityComponent(
  code: number,
  description: string,
  min: number,
  max: number,
  equipment: string,
) {
  return {
    codExame: 500517, codComponente: code, descricao: description,
    referenciaTecnica: `${min} - ${max}`, metodo: '', equipamento: equipment,
    tipoResultado: 1, unidade: 'mm', numeroDecimais: 2,
    resultadoMin: min, resultadoMax: max, nrTabela: 0, opcoesResultado: [],
  };
}

function teamFrom(value: unknown, teams: ReadonlyMap<string, Team>): Team {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const code = String(body['codigo'] ?? '').trim().toUpperCase();
  const previous = teams.get(code);
  const operatorCodes = Array.isArray(body['operadores'])
    ? body['operadores'].map(String)
    : previous?.operadores.map(operator => operator.codigo) ?? [];
  return {
    codigo: code,
    descricao: typeof body['descricao'] === 'string' ? body['descricao'] : previous?.descricao ?? 'Equipe E2E',
    turno: typeof body['turno'] === 'string' ? body['turno'] : previous?.turno ?? 'Turno 1',
    operadores: operatorCodes.map(operatorCode => {
      const operator = OPERATORS.find(item => item.code === operatorCode);
      return { codigo: operatorCode, nome: operator?.name ?? operatorCode };
    }),
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', json: body });
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
