import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReportOperacaoService } from '../../report-operacao/services/report-operacao.service';
import { IniciarBateladaResponse } from '../interfaces/reporta-batelada.dto';
import {
  AreaProducaoBatelada,
  OrdemLiberadaBatelada,
  ResponsavelBatelada,
} from '../models/reporta-batelada.model';

import { ReportaBateladaService } from './reporta-batelada.service';

describe('ReportaBateladaService', () => {
  let service: ReportaBateladaService;
  let catalogMock: {
    listarAreasProducao: ReturnType<typeof vi.fn>;
    pesquisarCentrosTrabalho: ReturnType<typeof vi.fn>;
    listarOrdensPorCentro: ReturnType<typeof vi.fn>;
    listarResponsaveis: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    catalogMock = {
      listarAreasProducao: vi.fn(() => of([{ code: '4001', description: 'Produção' }])),
      pesquisarCentrosTrabalho: vi.fn(() => of([workCenter()])),
      listarOrdensPorCentro: vi.fn(() => of([order('1'), order('2')])),
      listarResponsaveis: vi.fn(() => of([responsavel()])),
    };

    TestBed.configureTestingModule({
      providers: [
        ReportaBateladaService,
        { provide: ReportOperacaoService, useValue: catalogMock },
      ],
    });
    service = TestBed.inject(ReportaBateladaService);
  });

  it('delegates Area/CT catalogs and returns defensive copies', async () => {
    const areas = await firstValueFrom(service.listarAreas());
    const centers = await firstValueFrom(service.pesquisarCentros('4001', 'ext'));

    expect(catalogMock.listarAreasProducao).toHaveBeenCalledOnce();
    expect(catalogMock.pesquisarCentrosTrabalho).toHaveBeenCalledWith('4001', 'ext');
    expect(areas).toEqual([{ code: '4001', description: 'Produção' }]);
    expect(centers).toEqual([workCenter()]);
    expect(areas).not.toBe(await firstValueFrom(service.listarAreas()));
  });

  it('lists only released orders for a valid Area/CT and clones every result', async () => {
    const result = await firstValueFrom(service.listarOrdensLiberadas('4001', 'CT-EXT-01'));

    expect(catalogMock.listarOrdensPorCentro).toHaveBeenCalledWith('4001', 'CT-EXT-01');
    expect(result).toEqual([order('1'), order('2')]);
    const source = await firstValueFrom(of([order('1'), order('2')]));
    expect(result[0]).not.toBe(source[0]);
  });

  it('does not query orders without a complete context', async () => {
    expect(await firstValueFrom(service.listarOrdensLiberadas('', 'CT-EXT-01'))).toEqual([]);
    expect(await firstValueFrom(service.listarOrdensLiberadas('4001', ''))).toEqual([]);
    expect(catalogMock.listarOrdensPorCentro).not.toHaveBeenCalled();
  });

  it('lists eligible responsible parties through its semantic boundary', async () => {
    const result = await firstValueFrom(service.listarResponsaveisElegiveis('4001', 'CT-EXT-01'));

    expect(result).toEqual([responsavel()]);
    expect(result[0]).not.toBe(responsavel());
  });

  it('builds one command containing context, responsible party and all ordered items', () => {
    const request = service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('2'), order('1')],
    );

    expect(request).toEqual({
      contexto: { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel: { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      ordens: [order('2'), order('1')],
    });
    expect(request.ordens[0]).not.toBe(order('2'));
  });

  it('starts the complete batch atomically and returns a defensive timestamp', async () => {
    const request = service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('1'), order('2')],
    );

    const result = await firstValueFrom(service.iniciarBatelada(request));

    expect(result.ordensIniciadas).toEqual(['1', '2']);
    expect(result.iniciadoEm).toBeInstanceOf(Date);
  });

  it.each([
    {
      status: 'RESULTADO_PARCIAL',
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '2', sucesso: false, mensagem: 'Falha Datasul' },
      ],
    },
    {
      status: 'SUCESSO_INTEGRAL',
      resultados: [{ ordemId: '1', sucesso: true }],
    },
  ] satisfies ReadonlyArray<IniciarBateladaResponse>)(
    'rejects a partial or inconsistent start response',
    response => {
      expect(() => service.validarRespostaInicio(response, ['1', '2']))
        .toThrowError('O início conjunto não foi confirmado para todas as ordens.');
    },
  );
});

function workCenter() {
  return {
    code: 'CT-EXT-01',
    description: 'Extrusão Linha 01',
    areaCode: '4001',
    area: 'Produção',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
}

function order(id: string): OrdemLiberadaBatelada {
  return {
    id,
    ordem: `45000${id}`,
    itemOp: `PERFIL-${id} / OP-${id}`,
    operacao: '10',
    split: '01',
  };
}

function responsavel(): ResponsavelBatelada {
  return { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' };
}

const _areaTypeCheck: AreaProducaoBatelada = { code: '4001', description: 'Produção' };
