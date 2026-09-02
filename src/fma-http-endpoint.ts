import express, { type Application, type Request, type Response as ExpressResponse } from 'express';

import { APP_PERMISSIONS } from './app-permissions';
import { verifyAppSessionToken } from './app-session-token';
import {
  QualityControlGatewayError,
  readQualityControlDatasulConfig,
  type QualityControlEnvironment,
  type QualityControlTransport,
} from './quality-control-datasul-client';
import { noopLogger, type ApplicationLogger } from './logging/log-contracts';
import { normalizedRoute } from './server-observability';
import {
  observeUpstreamFetch,
  reportUpstreamRequestCompleted,
  reportUpstreamResponseFailure,
  type UpstreamRequestDetails,
} from './server-upstream-observability';

const FMA_PERMISSIONS = [
  APP_PERMISSIONS.operationReporting,
  APP_PERMISSIONS.batchReporting,
  APP_PERMISSIONS.stoppages,
] as const;

export interface FmaEndpointDependencies {
  readonly env: QualityControlEnvironment;
  readonly transport?: QualityControlTransport;
  readonly timeoutSignal?: (timeoutMs: number) => AbortSignal;
  readonly now?: () => Date;
  readonly logger?: ApplicationLogger;
  readonly clock?: () => number;
}

type JsonObject = Record<string, unknown>;
type FmaErrorCategory = 'CONFLICT' | 'VALIDATION';

class FmaPublicCommandError extends QualityControlGatewayError {
  readonly publicBody: {
    readonly code: string;
    readonly category: FmaErrorCategory;
    readonly userMessage: string;
  };

  constructor(status: number, code: string, category: FmaErrorCategory, userMessage: string) {
    super(status, code);
    this.name = 'FmaPublicCommandError';
    this.publicBody = { code, category, userMessage };
  }
}

const COMMAND_CACHE_TTL_MS = 15 * 60_000;
const COMMAND_CACHE_MAX_ENTRIES = 1_000;

export function installFmaEndpoints(app: Application, dependencies: FmaEndpointDependencies): void {
  const commandRequests = new Map<string, {
    readonly canonical: string;
    readonly promise: Promise<ReturnType<typeof receipt>>;
    readonly createdAt: number;
    settledAt?: number;
  }>();
  const roots = [
    '/api/production-areas', '/api/work-centers', '/api/operators',
    '/api/operational-responsibles', '/api/teams', '/api/scrap-reasons',
    '/api/stop-reasons', '/api/production-orders', '/api/operations',
    '/api/batches', '/api/production-stops',
  ];
  for (const root of roots) app.use(root, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '64kb' }));

  app.get('/api/work-centers', (req, res) => handle(req, res, dependencies, async client => {
    const areaCode = optionalText(req.query['areaCode']);
    const upstream = await client.request('GET', '/api/fma/v1/centrostrabalho', undefined, {
      ...(areaCode ? { codAreaProduc: areaCode } : {}),
    });
    const term = optionalText(req.query['term']).toLocaleLowerCase('pt-BR');
    return dataset(upstream, 'centrosTrabalho').map(row => {
      const item = objectOfUpstream(row);
      return {
        code: text(item['codCtrab']),
        description: text(item['desCtrab']),
        areaCode: text(item['codAreaProduc']),
        area: '',
        machineGroup: '',
        establishment: '',
        active: true,
      };
    }).filter(center => !term || `${center.code} ${center.description}`.toLocaleLowerCase('pt-BR').includes(term));
  }));

  app.get('/api/production-orders', (req, res) => handle(req, res, dependencies, async client => {
    const areaCode = requiredText(req.query['areaCode']);
    const workCenterCode = requiredText(req.query['workCenterCode']);
    const upstream = await client.request('GET', '/api/fma/v1/ordensliberadas', undefined, {
      codAreaProduc: areaCode,
      codCtrab: workCenterCode,
    });
    return dataset(upstream, 'ordensLiberadas').map(row => {
      const item = objectOfUpstream(row);
      const ordem = integerText(item['nrOrdemProducao']);
      const itemOp = text(item['codItemOp']);
      const operacao = integerText(item['opCodigo']);
      const split = integerText(item['numSplitOperac']);
      const indEstadoSplit = positiveIntegerUpstream(item['indEstadoSplit']);
      return {
        id: `${ordem}|${itemOp}|${operacao}|${split}`,
        ordem, itemOp, operacao, split, indEstadoSplit, areaCode, workCenterCode,
      };
    });
  }));

  app.get('/api/production-orders/:order/operations/:operation', (req, res) =>
    handle(req, res, dependencies, async client => {
      const areaCode = requiredText(req.query['areaCode']);
      const workCenterCode = requiredText(req.query['workCenterCode']);
      const orderNumber = positiveInteger(req.params['order']);
      const operationCode = positiveInteger(req.params['operation']);
      const splitNumber = positiveInteger(req.query['split']);
      const splitState = req.query['splitState'] === undefined
        ? undefined
        : positiveInteger(req.query['splitState']);
      const upstream = await client.request('GET', '/api/fma/v1/abrirapontamento', undefined, {
        codAreaProduc: areaCode,
        codCtrab: workCenterCode,
        nrOrdemProducao: orderNumber,
        opCodigo: operationCode,
        numSplitOperac: splitNumber,
      });
      const item = objectOfUpstream(single(dataset(upstream, 'dadosApontamento')));
      const reportModeValue = item['indReporteMod'] ?? item['indReportMod'];
      const indReporteMod = typeof reportModeValue === 'number' && Number.isSafeInteger(reportModeValue)
        ? reportModeValue
        : undefined;
      const start = splitState === 4
        ? startedSplitDetails(
            await client.request('GET', `/api/fcq/v1/ordens/${orderNumber}`),
            orderNumber,
            operationCode,
            splitNumber,
          )
        : undefined;
      return {
        ordem: integerText(item['nrOrdemProducao']),
        op: integerText(item['opCodigo']),
        split: integerText(item['numSplitOperac']),
        item: text(item['itCodigo']),
        descricao: text(item['descItem']),
        unidade: text(item['un']),
        roteiro: `${integerText(item['opCodigo'])} - ${text(item['desOperacao'])}`,
        quantidadeOrdem: finiteNumber(item['qtdOrdem']),
        quantidadeSaldo: finiteNumber(item['qtdSaldo']),
        linha: text(item['desCtrab']),
        ct: text(item['codCtrab']),
        grupoMaquina: text(item['desGrupoMaquina']),
        ...(indReporteMod === undefined ? {} : { indReporteMod }),
        ...(start ?? {}),
        operador: '', equipe: '', turno: text(item['desModelTurno']),
      };
    }));

  app.post('/api/operations/start', (req, res) => handle(req, res, dependencies, async client => {
    const body = objectOf(req.body);
    const responsibleType = requiredText(body['tipoResponsavel']);
    const responsibleCode = requiredText(body['codigoResponsavel']);
    if (responsibleType !== 'OPERADOR' && responsibleType !== 'EQUIPE') {
      throw new QualityControlGatewayError(400, 'invalid-request');
    }
    const command = {
      codAreaProduc: requiredText(body['areaCode']),
      codCtrab: requiredText(body['workCenterCode']),
      nrOrdemProducao: positiveInteger(body['ordem']),
      opCodigo: positiveInteger(body['op']),
      numSplitOperac: positiveInteger(body['split']),
      dataInicioReporte: isoDate(body['dataInicio']),
      horaInicioReporte: requiredText(body['horaInicio']),
      codOperador: responsibleType === 'OPERADOR' ? responsibleCode : '',
      codEquipe: responsibleType === 'EQUIPE' ? responsibleCode : '',
      codFerramenta: '', dataInicioSetup: '', horaInicioSetup: '', dataFimSetup: '', horaFimSetup: '',
    };
    const idempotencyKey = safeId(req.header('idempotency-key'));
    const cacheKey = `${client.subject}\u0000${idempotencyKey}`;
    const canonical = JSON.stringify(command);
    pruneCommandRequests(commandRequests, dependencies.now?.().getTime() ?? Date.now());
    const existing = commandRequests.get(cacheKey);
    if (existing) {
      if (existing.canonical !== canonical) {
        throw new QualityControlGatewayError(409, 'idempotency-conflict');
      }
      return { ...(await existing.promise), duplicate: true };
    }
    const promise = (async () => {
      const upstream = await client.request('POST', '/api/fma/v1/iniciaordem', command);
      const result = objectOfUpstream(single(dataset(upstream, 'inicioOrdem')));
      return receipt(
        idempotencyKey,
        `datasul:operation:${integerText(result['nrOrdemProducao'])}:${integerText(result['opCodigo'])}:${integerText(result['numSplitOperac'])}`,
        dependencies.now?.() ?? new Date(),
      );
    })();
    const cacheEntry: CommandRequestEntry = {
      canonical, promise, createdAt: dependencies.now?.().getTime() ?? Date.now(),
    };
    commandRequests.set(cacheKey, cacheEntry);
    try {
      const result = await promise;
      cacheEntry.settledAt = dependencies.now?.().getTime() ?? Date.now();
      return result;
    } catch (error) {
      commandRequests.delete(cacheKey);
      throw error;
    }
  }));

  installAdaptedRoutes(app, dependencies, commandRequests);
}

type CommandRequestEntry = {
  readonly canonical: string;
  readonly promise: Promise<ReturnType<typeof receipt>>;
  readonly createdAt: number;
  settledAt?: number;
};
type CommandRequestCache = Map<string, CommandRequestEntry>;

function installAdaptedRoutes(
  app: Application,
  dependencies: FmaEndpointDependencies,
  commandRequests: CommandRequestCache,
): void {
  app.get('/api/operators', (req, res) => handle(req, res, dependencies, async client => {
    const upstream = await client.request('GET', '/api/fma/v1/operadores');
    const term = optionalText(req.query['term']).toLocaleLowerCase('pt-BR');
    return dataset(upstream, 'operadores').map(row => {
      const item = objectOfUpstream(row);
      return { code: requiredUpstreamText(item['codOperador']), name: requiredUpstreamText(item['nomOperador']) };
    }).filter(operator => !term || `${operator.code} ${operator.name}`.toLocaleLowerCase('pt-BR').includes(term));
  }));

  app.get('/api/operational-responsibles', (req, res) => handle(req, res, dependencies, async client => {
    const areaCode = requiredText(req.query['areaCode']).toUpperCase();
    requiredText(req.query['workCenterCode']);
    const [operatorsUpstream, teamsUpstream] = await Promise.all([
      client.request('GET', '/api/fma/v1/operadores'),
      client.request('GET', '/api/fma/v1/equipes'),
    ]);
    const operators = dataset(operatorsUpstream, 'operadores').flatMap(row => {
      const item = objectOfUpstream(row);
      if (text(item['codAreaProduc']).trim().toUpperCase() !== areaCode) return [];
      return [{
        tipo: 'OPERADOR',
        codigo: requiredUpstreamText(item['codOperador']),
        nome: requiredUpstreamText(item['nomOperador']),
      }];
    });
    const teams = dataset(teamsUpstream, 'Equipes').flatMap(row => {
      const item = objectOfUpstream(row);
      if (text(item['codAreaProduc']).trim().toUpperCase() !== areaCode) return [];
      return [{
        tipo: 'EQUIPE',
        codigo: requiredUpstreamText(item['codEquipe']),
        nome: requiredUpstreamText(item['nomEquipe']),
      }];
    });
    return [...operators, ...teams];
  }));

  app.get('/api/teams', (req, res) => handle(req, res, dependencies, async client => {
    const areaCode = requiredText(req.query['areaCode']).toUpperCase();
    const upstream = await client.request('GET', '/api/fma/v1/equipes');
    return dataset(upstream, 'Equipes').flatMap(row => {
      const item = objectOfUpstream(row);
      if (text(item['codAreaProduc']).trim().toUpperCase() !== areaCode) return [];
      return [{
        codigo: requiredUpstreamText(item['codEquipe']),
        descricao: requiredUpstreamText(item['nomEquipe']),
        turno: String(nonNegativeIntegerUpstream(item['numTurno'])),
        operadores: [],
      }];
    });
  }));

  app.get('/api/scrap-reasons', (req, res) => handle(req, res, dependencies, async client => {
    const upstream = await client.request('GET', '/api/fma/v1/motivosrefugo');
    const term = optionalText(req.query['term']).toLocaleLowerCase('pt-BR');
    return dataset(upstream, 'motivosRefugo').map(row => {
      const item = objectOfUpstream(row);
      return {
        codigo: requiredUpstreamText(item['codMotivoRefugo']),
        descricao: requiredUpstreamText(item['desMotivoRefugo']),
        materialScrap: booleanOf(item['refugoMaterial']),
        rework: booleanOf(item['refugoRetrabalho']),
      };
    }).filter(reason => !term || `${reason.codigo} ${reason.descricao}`.toLocaleLowerCase('pt-BR').includes(term));
  }));

  app.get('/api/stop-reasons', (req, res) => handle(req, res, dependencies, async client => {
    const upstream = await client.request('GET', '/api/fma/v1/motivosparada');
    return dataset(upstream, 'motivosParada').flatMap(row => {
      const item = objectOfUpstream(row);
      const code = text(item['codParada']);
      const description = text(item['desParada']);
      const id = Number(code);
      return code && description && Number.isSafeInteger(id) ? [{ id, code, description }] : [];
    });
  }));

  app.get('/api/production-stops', (req, res) => handle(req, res, dependencies, async client => {
    const workCenterCode = requiredText(req.query['workCenterCode']);
    const upstream = await client.request(
      'GET',
      '/api/fma/v1/paradasiniciadas',
      undefined,
      { codCtrab: workCenterCode },
    );
    return dataset(upstream, 'paradasIniciadas').map(row => {
      const item = objectOfUpstream(row);
      const reasonCode = requiredUpstreamText(item['codParada']);
      const reasonId = Number(reasonCode);
      const startDate = upstreamDate(item['dataInicioParada']) ?? invalidUpstream();
      const startTime = upstreamTime(item['horaInicioParada']) ?? invalidUpstream();
      const reportDate = upstreamDate(item['dataReporte']) ?? invalidUpstream();
      const rawReportTime = text(item['horaReporte']);
      const reportTime = rawReportTime ? upstreamTime(rawReportTime) ?? invalidUpstream() : '';
      const reportedBy = requiredUpstreamText(item['codUsuarReporte']);
      const teamCode = text(item['codEquipe']);
      if (!Number.isSafeInteger(reasonId) || reasonId <= 0) return invalidUpstream();
      const responsible = teamCode
        ? { tipo: 'EQUIPE', codigo: teamCode, nome: teamCode }
        : { tipo: 'OPERADOR', codigo: reportedBy, nome: reportedBy };
      return {
        id: [
          'datasul', workCenterCode, startDate, startTime, reasonCode,
          responsible.codigo, reportedBy,
        ].join(':'),
        programNumber: nonNegativeIntegerUpstream(item['numOmProgda']),
        workCenterCode: requiredUpstreamText(item['codCtrab']),
        reason: {
          id: reasonId,
          code: reasonCode,
          description: requiredUpstreamText(item['desParada']),
        },
        responsible,
        startDate,
        startTime,
        reportDate,
        reportTime,
        reportedBy,
      };
    });
  }));

  app.post('/api/teams', (req, res) => handle(req, res, dependencies, async client => {
    const body = objectOf(req.body);
    const operators = uniqueRequiredTexts(body['operadores']);
    const command = {
      codAreaProduc: requiredText(body['areaCode']),
      codCtrab: requiredText(body['workCenterCode']),
      operadores: operators,
    };
    const upstream = await client.request('POST', '/api/fma/v1/geraequipe', command);
    const result = objectOfUpstream(single(dataset(upstream, 'equipeResultado')));
    const returnedOperators = dataset(upstream, 'operadores').map(row => {
      const item = objectOfUpstream(row);
      return { codigo: requiredUpstreamText(item['codOperador']), nome: requiredUpstreamText(item['nomOperador']) };
    });
    return {
      codigo: requiredUpstreamText(result['codEquipe']),
      descricao: requiredUpstreamText(result['desEquipe']),
      turno: String(nonNegativeIntegerUpstream(result['numTurno'])),
      operadores: returnedOperators,
    };
  }));

  app.post('/api/operations/report', (req, res) => handle(req, res, dependencies, client => {
    const body = objectOf(req.body);
    const command = reportCommand(body, false);
    return idempotentCommand(req, client, dependencies, commandRequests, '/api/fma/v1/reporteordem', command, 'operation-report');
  }));

  app.post('/api/operations/end', (req, res) => handle(req, res, dependencies, client => {
    const body = objectOf(req.body);
    const command = {
      codAreaProduc: requiredText(body['areaCode']),
      codCtrab: requiredText(body['ct']),
      nrOrdemProducao: positiveInteger(body['ordem']),
      opCodigo: positiveInteger(body['op']),
      numSplitOperac: positiveInteger(body['split']),
    };
    return idempotentCommand(
      req,
      client,
      dependencies,
      commandRequests,
      '/api/fma/v1/encerrasplit',
      command,
      'operation-end',
      [],
      upstream => validateEndSplitResponse(upstream, command),
    );
  }));

  app.post('/api/batches/start', (req, res) => handle(req, res, dependencies, client => {
    const body = objectOf(req.body);
    const context = objectOf(body['contexto']);
    const responsible = objectOf(body['responsavel']);
    const command = {
      codAreaProduc: requiredText(context['areaCode']),
      codCtrab: requiredText(context['workCenterCode']),
      dataInicioReporte: localDate(body['dataInicio']),
      horaInicioReporte: validTime(body['horaInicio']),
      ...responsibleFields(responsible['tipo'], responsible['codigo']),
      ...emptySetupFields(),
      splits: requiredObjects(body['ordens']).map(order => ({
        nrOrdemProducao: positiveInteger(order['ordem']),
        opCodigo: positiveInteger(order['operacao']),
        numSplitOperac: positiveInteger(order['split']),
      })),
    };
    return idempotentCommand(
      req, client, dependencies, commandRequests, '/api/fma/v1/iniciarordembatelada', command,
      'batch-start', requiredObjects(body['ordens']).map(order => requiredText(order['id'])),
    );
  }));

  app.post('/api/batches/report', (req, res) => handle(req, res, dependencies, client => {
    const body = objectOf(req.body);
    const command = reportCommand(body, true);
    return idempotentCommand(
      req, client, dependencies, commandRequests, '/api/fma/v1/reporteordembatelada', command,
      'batch-report', requiredObjects(body['items']).map(item => requiredText(item['orderId'])),
    );
  }));

  app.post('/api/batches/end', (req, res) => handle(req, res, dependencies, client => {
    const body = objectOf(req.body);
    return localOnlyCommand(
      req, client, dependencies, commandRequests, body, 'batch-end', requiredTexts(body['orderIds']),
    );
  }));

  app.post('/api/production-stops', (req, res) => handle(req, res, dependencies, client => {
    const body = objectOf(req.body);
    const context = objectOf(body['context']);
    const area = objectOf(context['area']);
    const center = objectOf(context['workCenter']);
    const reason = objectOf(body['reason']);
    const responsible = objectOf(body['responsible']);
    const endDate = optionalText(body['endDate']);
    const endTime = optionalText(body['endTime']);
    if (Boolean(endDate) !== Boolean(endTime)) throw new QualityControlGatewayError(400, 'invalid-request');
    const base = {
      codAreaProduc: requiredText(area['code']),
      codCtrab: requiredText(center['code']),
      codParada: requiredText(reason['code']),
      dataInicioParada: localDate(body['startDate']),
      horaInicioParada: validTime(body['startTime']),
      ...responsibleFields(responsible['tipo'], responsible['codigo']),
      numOmProgda: 0,
    };
    const end = endDate ? {
      dataFimParada: localDate(endDate),
      horaFimParada: validTime(endTime),
    } : undefined;
    if (end) assertChronological(
      base.dataInicioParada, base.horaInicioParada, end.dataFimParada, end.horaFimParada,
    );
    const command = end ? { ...base, ...end } : base;
    const endpoint = endDate ? '/api/fma/v1/incluiparada' : '/api/fma/v1/iniciaparada';
    return idempotentCommand(req, client, dependencies, commandRequests, endpoint, command, 'production-stop');
  }));

  for (const path of ['/api/production-stops/finish', '/api/production-stops/:id/finish']) {
    app.post(path, (req, res) => handle(req, res, dependencies, client => {
      const body = objectOf(req.body);
      const command = {
        codAreaProduc: requiredText(body['areaCode']),
        codCtrab: requiredText(body['workCenterCode']),
        dataFimParada: localDate(body['endDate']),
        horaFimParada: validTime(body['endTime']),
      };
      return idempotentCommand(req, client, dependencies, commandRequests, '/api/fma/v1/finalizaparada', command, 'production-stop-finish');
    }));
  }

  app.post('/api/production-stops/:id/eliminate', (req, res) =>
    handle(req, res, dependencies, client => {
      const body = objectOf(req.body);
      const stopLocalId = requiredText(body['stopLocalId']);
      if (stopLocalId !== requiredText(req.params['id'])) {
        throw new QualityControlGatewayError(400, 'invalid-request');
      }
      const command = {
        codAreaProduc: requiredText(body['areaCode']),
        codCtrab: requiredText(body['workCenterCode']),
        codParada: requiredText(body['reasonCode']),
        dataInicioParada: localDate(body['startDate']),
        horaInicioParada: validTime(body['startTime']),
      };
      return idempotentCommand(
        req,
        client,
        dependencies,
        commandRequests,
        '/api/fma/v1/eliminaparada',
        command,
        'production-stop-delete',
      );
    }));

  const reads = ['/api/teams/:code'];
  for (const path of reads) app.get(path, (req, res) => handle(req, res, dependencies, client =>
    client.request('GET', concretePath(req), undefined, queryObject(req), normalizedRoute(req))));
  app.put('/api/teams/:code', (req, res) => handle(req, res, dependencies, client =>
    client.request('PUT', concretePath(req), objectOf(req.body), {}, normalizedRoute(req))));
}

function reportCommand(body: JsonObject, batch: boolean): JsonObject {
  const items = batch ? requiredObjects(body['items']) : [body];
  const context = batch ? objectOf(body['contexto']) : body;
  const responsible = batch ? objectOf(body['responsavel']) : body;
  const startedAt = batch ? requiredText(body['dataInicio']) : requiredText(body['dataInicio']);
  const endedAt = batch ? requiredText(body['dataFim']) : requiredText(body['dataFim']);
  const dataInicioReporte = localDate(startedAt);
  const horaInicioReporte = validTime(body['horaInicio']);
  const dataFimReporte = localDate(endedAt);
  const horaFimReporte = validTime(body['horaFim']);
  assertChronological(dataInicioReporte, horaInicioReporte, dataFimReporte, horaFimReporte);
  const splits = items.map(item => reportSplit(item, batch));
  if (splits.reduce((total, split) => total
    + Number(split['qtdAprovada']) + Number(split['qtdRetrabalho']) + Number(split['qtdRefugada']), 0) <= 0) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  const common = {
    codAreaProduc: requiredText(context['areaCode']),
    codCtrab: requiredText(batch ? context['workCenterCode'] : body['ct']),
    dataInicioReporte,
    horaInicioReporte,
    dataFimReporte,
    horaFimReporte,
    ...responsibleFields(
      batch ? responsible['tipo'] : body['tipoResponsavel'],
      batch ? responsible['codigo'] : body['codigoResponsavel'],
    ),
    ...emptySetupFields(),
    finalizarSplit: requiredBoolean(body['finalizarSplit']),
  };
  if (batch) {
    return { ...common, splits };
  }
  return {
    ...common,
    ...splits[0],
    codReferencia: '',
    loteSerie: '',
    dataValidadeLote: '',
    contaRefugo: '',
  };
}

function reportSplit(item: JsonObject, batch: boolean): JsonObject {
  const approved = nonNegativeFinite(item['quantidadeAprovada']);
  const rework = nonNegativeFinite(item['quantidadeRetrabalho']);
  const scrap = nonNegativeFinite(item['quantidadeRefugo']);
  const reasons = objectArray(item['refugoItens']);
  const requiresReason = scrap > 0;
  if ((requiresReason && reasons.length !== 1) || (!requiresReason && reasons.length !== 0)) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  const identity = batch ? batchItemIdentity(item) : {
    ordem: item['ordem'], operation: item['op'], split: item['split'],
  };
  return {
    nrOrdemProducao: positiveInteger(identity.ordem),
    opCodigo: positiveInteger(identity.operation),
    numSplitOperac: positiveInteger(identity.split),
    qtdAprovada: approved,
    qtdRetrabalho: rework,
    qtdRefugada: scrap,
    codMotivoRefugo: reasons.length === 1
      ? requiredText(reasons[0][batch ? 'motivoCode' : 'codigo'])
      : '',
  };
}

function batchItemIdentity(item: JsonObject): { ordem: unknown; operation: unknown; split: unknown } {
  const parts = requiredText(item['orderId']).split('|');
  if (parts.length !== 4) throw new QualityControlGatewayError(400, 'invalid-request');
  const identity = {
    ordem: item['ordem'] ?? parts[0],
    operation: item['operacao'] ?? parts[2],
    split: item['split'] ?? parts[3],
  };
  if (
    (item['ordem'] !== undefined && String(item['ordem']) !== parts[0])
    || (item['operacao'] !== undefined && String(item['operacao']) !== parts[2])
    || (item['split'] !== undefined && String(item['split']) !== parts[3])
  ) throw new QualityControlGatewayError(400, 'invalid-request');
  return identity;
}

function responsibleFields(type: unknown, code: unknown): { codOperador: string; codEquipe: string } {
  const responsibleType = requiredText(type);
  const responsibleCode = requiredText(code);
  if (responsibleType !== 'OPERADOR' && responsibleType !== 'EQUIPE') {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return {
    codOperador: responsibleType === 'OPERADOR' ? responsibleCode : '',
    codEquipe: responsibleType === 'EQUIPE' ? responsibleCode : '',
  };
}

function emptySetupFields() {
  return {
    codFerramenta: '', dataInicioSetup: '', horaInicioSetup: '', dataFimSetup: '', horaFimSetup: '',
  };
}

async function idempotentCommand(
  req: Request,
  client: FmaClient,
  dependencies: FmaEndpointDependencies,
  commandRequests: CommandRequestCache,
  endpoint: string,
  command: JsonObject,
  resource: string,
  orderIds: readonly string[] = [],
  validateResponse?: (upstream: unknown) => void,
): Promise<ReturnType<typeof receipt>> {
  const idempotencyKey = safeId(req.header('idempotency-key'));
  const cacheKey = `${client.subject}\u0000${endpoint}\u0000${idempotencyKey}`;
  const canonical = JSON.stringify(command);
  const now = dependencies.now?.().getTime() ?? Date.now();
  pruneCommandRequests(commandRequests, now);
  const existing = commandRequests.get(cacheKey);
  if (existing) {
    if (existing.canonical !== canonical) throw new QualityControlGatewayError(409, 'idempotency-conflict');
    return { ...(await existing.promise), duplicate: true };
  }
  const promise = (async () => {
    const upstream = await client.request('POST', endpoint, command, {}, endpoint, !validateResponse);
    validateResponse?.(upstream);
    return receipt(
      idempotencyKey,
      `datasul:${resource}:${idempotencyKey}`,
      dependencies.now?.() ?? new Date(),
      orderIds,
    );
  })();
  const cacheEntry: CommandRequestEntry = { canonical, promise, createdAt: now };
  commandRequests.set(cacheKey, cacheEntry);
  try {
    const result = await promise;
    cacheEntry.settledAt = dependencies.now?.().getTime() ?? Date.now();
    return result;
  }
  catch (error) { commandRequests.delete(cacheKey); throw error; }
}

function validateEndSplitResponse(upstream: unknown, command: JsonObject): void {
  const result = objectOfUpstream(single(dataset(upstream, 'splitResultado')));
  booleanOf(result['operacaoFechada']);
  const returnedOrder = positiveIntegerUpstream(result['nrOrdemProducao']);
  const returnedOperation = positiveIntegerUpstream(result['opCodigo']);
  const returnedSplit = positiveIntegerUpstream(result['numSplitOperac']);
  if (
    returnedOrder !== command['nrOrdemProducao']
    || returnedOperation !== command['opCodigo']
    || returnedSplit !== command['numSplitOperac']
  ) invalidUpstream();
}

async function localOnlyCommand(
  req: Request,
  client: FmaClient,
  dependencies: FmaEndpointDependencies,
  commandRequests: CommandRequestCache,
  command: JsonObject,
  resource: string,
  orderIds: readonly string[] = [],
): Promise<ReturnType<typeof receipt>> {
  const idempotencyKey = safeId(req.header('idempotency-key'));
  const cacheKey = `${client.subject}\u0000local:${resource}\u0000${idempotencyKey}`;
  const canonical = JSON.stringify(command);
  const now = dependencies.now?.().getTime() ?? Date.now();
  pruneCommandRequests(commandRequests, now);
  const existing = commandRequests.get(cacheKey);
  if (existing) {
    if (existing.canonical !== canonical) throw new QualityControlGatewayError(409, 'idempotency-conflict');
    return { ...(await existing.promise), duplicate: true };
  }
  const promise = Promise.resolve(receipt(
    idempotencyKey,
    `local:${resource}:${idempotencyKey}`,
    dependencies.now?.() ?? new Date(),
    orderIds,
  ));
  commandRequests.set(cacheKey, { canonical, promise, createdAt: now, settledAt: now });
  return promise;
}

function pruneCommandRequests(commandRequests: CommandRequestCache, now: number): void {
  for (const [key, entry] of commandRequests) {
    if (entry.settledAt !== undefined && now - entry.settledAt >= COMMAND_CACHE_TTL_MS) {
      commandRequests.delete(key);
    }
  }
  if (commandRequests.size < COMMAND_CACHE_MAX_ENTRIES) return;
  const settled = [...commandRequests.entries()]
    .filter((entry): entry is [string, CommandRequestEntry] => entry[1].settledAt !== undefined)
    .sort((left, right) => left[1].createdAt - right[1].createdAt);
  for (const [key] of settled) {
    if (commandRequests.size < COMMAND_CACHE_MAX_ENTRIES) break;
    commandRequests.delete(key);
  }
}

class FmaClient {
  private readonly config;
  constructor(
    readonly subject: string,
    private readonly dependencies: FmaEndpointDependencies,
  ) {
    this.config = readQualityControlDatasulConfig(dependencies.env);
  }

  async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: object,
    query: Record<string, string | number> = {},
    observableRoute = path,
    allowEmpty = false,
  ): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl);
    url.searchParams.set('companyId', String(this.config.companyId));
    url.searchParams.set('codUsuario', this.subject);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const authorization = Buffer.from(`${this.config.integrationUser}:${this.config.integrationPassword}`, 'utf8').toString('base64');
    const observation: UpstreamRequestDetails = {
      system: 'datasul',
      operation: operationName(method, observableRoute),
      method,
      route: observableRoute,
      protocol: this.config.baseUrl.protocol as 'http:' | 'https:',
      destinationHost: this.config.baseUrl.host,
    };
    let response: globalThis.Response;
    try {
      response = await observeUpstreamFetch(
        this.dependencies.logger ?? noopLogger,
        observation,
        () => (this.dependencies.transport ?? fetch)(url, {
          method,
          headers: {
            Accept: 'application/json', Authorization: `Basic ${authorization}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: (this.dependencies.timeoutSignal ?? AbortSignal.timeout)(this.config.requestTimeoutMs),
        }),
        this.dependencies.clock,
      );
    } catch {
      throw new QualityControlGatewayError(502, 'datasul-unavailable');
    }
    if (!response.ok) {
      const upstreamBody = await optionalJson(response);
      const businessError = method === 'GET'
        ? undefined
        : commandBusinessError(upstreamBody, observableRoute, response.status);
      if (businessError) throw businessError;
      throw new QualityControlGatewayError(response.status, 'datasul-request-failed');
    }
    try {
      const raw = await response.text();
      const parsed = raw.trim() ? JSON.parse(raw) as unknown : allowEmpty ? {} : invalidUpstream();
      if (allowEmpty && raw.trim() && isDatasulErrorEnvelope(parsed)) {
        const businessError = commandBusinessError(parsed, observableRoute, 422);
        if (businessError) throw businessError;
        throw new QualityControlGatewayError(502, 'datasul-request-failed');
      }
      reportUpstreamRequestCompleted(this.dependencies.logger ?? noopLogger, observation, response);
      return parsed;
    } catch (error) {
      if (error instanceof QualityControlGatewayError) throw error;
      reportUpstreamResponseFailure(
        this.dependencies.logger ?? noopLogger, observation, response, error,
      );
      throw new QualityControlGatewayError(502, 'invalid-upstream-response');
    }
  }
}

async function handle(
  req: Request,
  res: ExpressResponse,
  dependencies: FmaEndpointDependencies,
  operation: (client: FmaClient) => Promise<unknown>,
): Promise<void> {
  try {
    const userId = await resolveUser(req.header('authorization') ?? '', dependencies, req.path);
    res.status(200).json(await operation(new FmaClient(userId, dependencies)));
  } catch (error) {
    if (error instanceof FmaPublicCommandError) {
      res.status(error.status).json(error.publicBody);
      return;
    }
    if (error instanceof QualityControlGatewayError) {
      res.status(error.status).json({ code: error.code });
      return;
    }
    res.status(400).json({ code: 'invalid-request' });
  }
}

async function resolveUser(
  header: string,
  dependencies: FmaEndpointDependencies,
  path: string,
): Promise<string> {
  const secret = dependencies.env['APP_AUTH_TOKEN_SECRET'];
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32 || !match) {
    throw new QualityControlGatewayError(401, 'invalid-session');
  }
  let payload: Awaited<ReturnType<typeof verifyAppSessionToken>>;
  try { payload = await verifyAppSessionToken(match[1], secret, dependencies.now?.()); }
  catch { throw new QualityControlGatewayError(401, 'invalid-session'); }
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const permissions = Array.isArray(payload['permissions']) ? payload['permissions'] : [];
  if (!subject) {
    throw new QualityControlGatewayError(403, 'access-denied');
  }
  if (!hasPermissionForPath(path, permissions)) {
    throw new QualityControlGatewayError(403, 'access-denied');
  }
  return subject;
}

function hasPermissionForPath(path: string, permissions: readonly unknown[]): boolean {
  if (path.startsWith('/api/operations')) {
    return permissions.includes(APP_PERMISSIONS.operationReporting);
  }
  if (path.startsWith('/api/production-orders')) {
    return permissions.includes(APP_PERMISSIONS.operationReporting)
      || permissions.includes(APP_PERMISSIONS.batchReporting);
  }
  if (path.startsWith('/api/batches')) return permissions.includes(APP_PERMISSIONS.batchReporting);
  if (path.startsWith('/api/production-stops')) return permissions.includes(APP_PERMISSIONS.stoppages);
  return FMA_PERMISSIONS.some(permission => permissions.includes(permission));
}

function receipt(
  idempotencyKey: string,
  serverRecordId: string,
  current: Date,
  orderIds: readonly string[] = [],
) {
  const now = current.toISOString();
  return {
    serverRecordId, idempotencyKey, receivedAt: now, processedAt: now, duplicate: false,
    ...(orderIds.length > 0 ? {
      orderResults: orderIds.map(orderId => ({
        orderId,
        success: true,
      })),
    } : {}),
  };
}

function dataset(value: unknown, name: string): readonly unknown[] {
  const envelope = objectOfUpstream(value);
  const items = envelope['items'];
  if (!Array.isArray(items) || items.length !== 1) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  const rows = objectOfUpstream(items[0])[name];
  if (!Array.isArray(rows)) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  return rows;
}

function startedSplitDetails(
  value: unknown,
  expectedOrder: number,
  expectedOperation: number,
  expectedSplit: number,
): { readonly dataInicio: string; readonly horaInicio: string } {
  const envelope = objectOfUpstream(value);
  const items = envelope['items'];
  if (!Array.isArray(items) || items.length !== 1) return invalidUpstream();
  const dataset = objectOfUpstream(objectOfUpstream(items[0])['ds-ordem-producao']);
  const orders = dataset['ordem'];
  if (!Array.isArray(orders)) return invalidUpstream();
  const order = orders.map(objectOfUpstream).find(candidate =>
    candidate['nrOrdemProducao'] === expectedOrder);
  if (!order || !Array.isArray(order['operacoes'])) return invalidUpstream();
  const operation = order['operacoes'].map(objectOfUpstream).find(candidate =>
    candidate['codOperacao'] === expectedOperation);
  if (!operation || !Array.isArray(operation['splits'])) return invalidUpstream();
  const split = operation['splits'].map(objectOfUpstream).find(candidate =>
    candidate['numSplit'] === expectedSplit && candidate['estadoSplit'] === 4);
  if (!split) return invalidUpstream();

  const dataInicio = upstreamDate(split['dtInicioOperacao'])
    ?? upstreamDate(operation['dtInicioReal']);
  const horaInicio = upstreamTimeFromSeconds(split['segsInicioOperacao'])
    ?? upstreamTime(operation['horaInicioReal']);
  if (!dataInicio || !horaInicio) return invalidUpstream();
  return { dataInicio, horaInicio };
}

function upstreamDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? value
    : undefined;
}

function upstreamTimeFromSeconds(value: unknown): string | undefined {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= 86_400) {
    return undefined;
  }
  const hours = Math.floor((value as number) / 3_600);
  const minutes = Math.floor(((value as number) % 3_600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function upstreamTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = /^(\d{2})(\d{2})$/.exec(value.trim());
  const separated = /^(\d{2}):(\d{2})$/.exec(value.trim());
  const match = separated ?? compact;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1]}:${match[2]}`;
}

function objectOf(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QualityControlGatewayError(400, 'invalid-request');
  return value as JsonObject;
}
function objectOfUpstream(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidUpstream();
  return value as JsonObject;
}
function invalidUpstream(): never {
  throw new QualityControlGatewayError(502, 'invalid-upstream-response');
}
function single(values: readonly unknown[]): unknown {
  if (values.length !== 1) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  return values[0];
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function requiredText(value: unknown): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new QualityControlGatewayError(400, 'invalid-request');
  return result;
}
function optionalText(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function positiveInteger(value: unknown): number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || (number as number) <= 0) throw new QualityControlGatewayError(400, 'invalid-request');
  return number as number;
}
function integerText(value: unknown): string { return String(positiveInteger(value)); }
function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  return value;
}
function nonNegativeFinite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return value;
}
function booleanOf(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalidUpstream();
  return value;
}
function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new QualityControlGatewayError(400, 'invalid-request');
  return value;
}
function requiredUpstreamText(value: unknown): string {
  const result = text(value);
  if (!result) return invalidUpstream();
  return result;
}
function nonNegativeIntegerUpstream(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return invalidUpstream();
  return value as number;
}
function positiveIntegerUpstream(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return invalidUpstream();
  return value as number;
}
function requiredObjects(value: unknown): JsonObject[] {
  if (!Array.isArray(value) || value.length === 0) throw new QualityControlGatewayError(400, 'invalid-request');
  return value.map(objectOf);
}
function objectArray(value: unknown): JsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new QualityControlGatewayError(400, 'invalid-request');
  return value.map(objectOf);
}
function requiredTexts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new QualityControlGatewayError(400, 'invalid-request');
  return value.map(requiredText);
}
function uniqueRequiredTexts(value: unknown): string[] {
  const values = requiredTexts(value);
  const unique = [...new Set(values)];
  if (unique.length !== values.length) throw new QualityControlGatewayError(400, 'invalid-request');
  return unique;
}
function isoDate(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const calendarPart = /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1];
  if (calendarPart) assertCalendarDate(calendarPart);
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) throw new QualityControlGatewayError(400, 'invalid-request');
  return date.toISOString().slice(0, 10);
}
function localDate(value: unknown): string {
  const raw = requiredText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    assertCalendarDate(raw);
    return raw;
  }
  return isoDate(raw);
}
function assertCalendarDate(raw: string): void {
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) throw new QualityControlGatewayError(400, 'invalid-request');
}
function validTime(value: unknown): string {
  const result = requiredText(value);
  const match = /^(\d{2}):(\d{2})$/.exec(result);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return result;
}
function assertChronological(startDate: string, startTime: string, endDate: string, endTime: string): void {
  if (`${endDate}T${endTime}` < `${startDate}T${startTime}`) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
}
function isDatasulErrorEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as JsonObject;
  return (typeof envelope['type'] === 'string'
      && envelope['type'].toLocaleLowerCase('en-US') === 'error')
    || (typeof envelope['message'] === 'string' && Array.isArray(envelope['details']));
}

async function optionalJson(response: globalThis.Response): Promise<unknown> {
  try {
    const raw = await response.text();
    return raw.trim() ? JSON.parse(raw) as unknown : undefined;
  } catch {
    return undefined;
  }
}

function stopBusinessError(value: unknown, route: string): FmaPublicCommandError | undefined {
  if (!/^\/api\/fma\/v1\/(?:inicia|inclui|finaliza)parada$/u.test(route)) return undefined;
  const messages = datasulMessages(value);
  const conflict = messages.find(message => {
    const normalized = normalizedBusinessMessage(message);
    return normalized.includes('ja existe reporte') || normalized.includes('reporte ja cadastrado');
  });
  if (conflict) {
    return new FmaPublicCommandError(
      409,
      'DATASUL_STOP_INTERVAL_CONFLICT',
      'CONFLICT',
      conflict,
    );
  }
  const future = messages.find(message => {
    const normalized = normalizedBusinessMessage(message);
    return normalized.includes('reporte parada centro trab para o futuro')
      || normalized.includes('data de transacao maior que data do processamento');
  });
  if (future) {
    return new FmaPublicCommandError(422, 'DATASUL_FUTURE_STOP', 'VALIDATION', future);
  }
  return undefined;
}

function commandBusinessError(
  value: unknown,
  route: string,
  status: number,
): FmaPublicCommandError | undefined {
  if (
    route === '/api/fma/v1/iniciarordembatelada'
    && (status === 408 || status === 504)
  ) return undefined;
  const knownError = stopBusinessError(value, route);
  if (knownError) return knownError;
  const reason = datasulMessages(value).at(-1);
  if (reason) {
    return new FmaPublicCommandError(
      status,
      'DATASUL_COMMAND_REJECTED',
      'VALIDATION',
      reason,
    );
  }
  if (route === '/api/fma/v1/eliminaparada') {
    return new FmaPublicCommandError(
      422,
      'DATASUL_STOP_DELETE_REJECTED',
      'VALIDATION',
      'O Datasul rejeitou a eliminação da parada sem informar o motivo.',
    );
  }
  if (route === '/api/fma/v1/iniciarordembatelada') {
    return new FmaPublicCommandError(
      422,
      'DATASUL_BATCH_START_REJECTED',
      'VALIDATION',
      'O Datasul rejeitou o início da batelada sem informar o motivo. Verifique as ordens antes de tentar novamente.',
    );
  }
  return undefined;
}

function datasulMessages(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const envelope = value as JsonObject;
  const details = Array.isArray(envelope['details']) ? envelope['details'] : [];
  return [envelope, ...details]
    .flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as JsonObject;
      return [record['message'], record['detailedMessage']];
    })
    .filter((message): message is string => typeof message === 'string')
    .map(message => message.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim())
    .filter(message => Boolean(message) && !containsSensitiveData(message))
    .map(message => message.slice(0, 240));
}

function containsSensitiveData(message: string): boolean {
  return /(?:\b(?:password|passwd|senha|token|cookie|authorization|credential|credencial|jwt|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|(?:access|refresh)[-_ ]?token|supervisor[-_ ]?(?:pin|password|senha))\b|\bbearer\s+|\beyJ[A-Za-z0-9_-]{10,}\.)/iu
    .test(message);
}

function normalizedBusinessMessage(message: string): string {
  return message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

function safeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(value)) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return value;
}
function concretePath(req: Request): string { return req.path; }
function queryObject(req: Request): Record<string, string> {
  return Object.fromEntries(Object.entries(req.query).flatMap(([key, value]) =>
    typeof value === 'string' ? [[key, value]] : []));
}

function operationName(method: string, route: string): string {
  return `fma_${method.toLocaleLowerCase('en-US')}_${route}`
    .replace(/:[^/]+/g, 'resource')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}
