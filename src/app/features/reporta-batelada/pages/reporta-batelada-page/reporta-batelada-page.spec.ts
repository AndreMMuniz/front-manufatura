import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoNotificationService } from '@po-ui/ng-components';

import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { OrdemLiberadaBatelada } from '../../models/reporta-batelada.model';
import { ReportaBateladaService } from '../../services/reporta-batelada.service';

import { ReportaBateladaPage } from './reporta-batelada-page';

describe('ReportaBateladaPage - consulta e seleção', () => {
  let fixture: ComponentFixture<ReportaBateladaPage>;
  let component: ReportaBateladaPage;
  let currentContext: ReturnType<typeof context> | null;
  let serviceMock: {
    listarAreas: ReturnType<typeof vi.fn>;
    pesquisarCentros: ReturnType<typeof vi.fn>;
    listarOrdensLiberadas: ReturnType<typeof vi.fn>;
    listarResponsaveisElegiveis: ReturnType<typeof vi.fn>;
    montarComandoInicio: ReturnType<typeof vi.fn>;
    iniciarBatelada: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    currentContext = context();
    serviceMock = {
      listarAreas: vi.fn(() => of([{ code: '4001', description: 'Produção' }])),
      pesquisarCentros: vi.fn(() => of([context().workCenter])),
      listarOrdensLiberadas: vi.fn(() => of(orders())),
      listarResponsaveisElegiveis: vi.fn(() => of([])),
      montarComandoInicio: vi.fn((contexto, responsavel, ordensSelecionadas) => ({
        contexto,
        responsavel,
        ordens: ordensSelecionadas,
      })),
      iniciarBatelada: vi.fn(() => of({
        iniciadoEm: new Date(2026, 6, 23, 8, 15),
        ordensIniciadas: ['2', '1'],
      })),
    };

    await TestBed.configureTestingModule({
      imports: [ReportaBateladaPage],
      providers: [
        { provide: ReportaBateladaService, useValue: serviceMock },
        { provide: OperationalContextService, useValue: { get currentContext() { return currentContext; } } },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: PoNotificationService,
          useValue: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), information: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportaBateladaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('prefills Area and CT from a BATCH operational context', () => {
    expect(component.view.area?.code).toBe('4001');
    expect(component.view.workCenter?.code).toBe('CT-EXT-01');
    expect(serviceMock.pesquisarCentros).toHaveBeenCalledWith('4001', '');
  });

  it('supports direct Home access without fabricating context', () => {
    currentContext = null;
    fixture = TestBed.createComponent(ReportaBateladaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.view.area).toBeNull();
    expect(component.view.workCenter).toBeNull();
    expect(component.areas).toEqual([{ code: '4001', description: 'Produção' }]);
  });

  it('invalidates CT, orders and selection when Area changes', () => {
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['1', '2']));
    component.prepararBatelada();

    component.selecionarArea('');

    expect(component.view.workCenter).toBeNull();
    expect(component.view.orders).toEqual([]);
    expect(component.view.composition).toEqual([]);
  });

  it('renders empty, error and retry states without losing context', () => {
    serviceMock.listarOrdensLiberadas.mockReturnValueOnce(of([]));
    component.consultarOrdens();
    expect(component.view.asyncState).toBe('vazio');

    serviceMock.listarOrdensLiberadas.mockReturnValueOnce(throwError(() => new Error('offline')));
    component.consultarOrdens();

    expect(component.view.asyncState).toBe('erro');
    expect(component.view.area?.code).toBe('4001');
    expect(component.view.workCenter?.code).toBe('CT-EXT-01');

    component.consultarOrdens();
    expect(serviceMock.listarOrdensLiberadas).toHaveBeenCalledTimes(3);
  });

  it('ignores an obsolete order response after the work center changes', () => {
    const first = new Subject<ReadonlyArray<OrdemLiberadaBatelada>>();
    serviceMock.listarOrdensLiberadas.mockReturnValueOnce(first);
    component.consultarOrdens();

    component.selecionarCentro('');
    first.next(orders());

    expect(component.view.orders).toEqual([]);
  });

  it('preserves touch/table selection order when preparing the composition', () => {
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['2']));
    component.atualizarSelecao(new Set(['2', '1']));

    component.prepararBatelada();

    expect(component.view.composition.map(order => order.id)).toEqual(['2', '1']);
  });

  it('sends exactly one ordered command for every order in the composition', () => {
    prepareForStart();

    component.iniciarBatelada();

    expect(serviceMock.montarComandoInicio).toHaveBeenCalledWith(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      [orders()[1], orders()[0]],
    );
    expect(serviceMock.iniciarBatelada).toHaveBeenCalledOnce();
    expect(component.view.estado).toBe('BateladaIniciada');
    expect(component.view.inicio?.ordensIniciadas).toEqual(['2', '1']);
  });

  it('prevents duplicate start commands from double click', () => {
    const pending = new Subject<{
      readonly iniciadoEm: Date;
      readonly ordensIniciadas: ReadonlyArray<string>;
    }>();
    serviceMock.iniciarBatelada.mockReturnValue(pending);
    prepareForStart();

    component.iniciarBatelada();
    component.iniciarBatelada();

    expect(serviceMock.iniciarBatelada).toHaveBeenCalledOnce();
    expect(component.view.estado).toBe('Iniciando');
  });

  it('preserves context, responsible party and composition on total/partial failure and allows retry', () => {
    serviceMock.iniciarBatelada.mockReturnValueOnce(
      throwError(() => new Error('O início conjunto não foi confirmado para todas as ordens.')),
    );
    prepareForStart();

    component.iniciarBatelada();

    expect(component.view.estado).toBe('BateladaPreparada');
    expect(component.view.composition.map(order => order.id)).toEqual(['2', '1']);
    expect(component.view.responsavel?.codigo).toBe('OP-001');
    expect(component.view.errorMessage).toContain('Não foi possível iniciar');

    component.iniciarBatelada();
    expect(serviceMock.iniciarBatelada).toHaveBeenCalledTimes(2);
    expect(component.view.estado).toBe('BateladaIniciada');
  });

  it('keeps start unavailable without an eligible responsible party', () => {
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['1']));
    component.prepararBatelada();

    component.iniciarBatelada();

    expect(serviceMock.iniciarBatelada).not.toHaveBeenCalled();
    expect(component.view.estado).toBe('BateladaPreparada');
  });

  function prepareForStart(): void {
    serviceMock.listarResponsaveisElegiveis.mockReturnValue(of([
      { tipo: 'OPERADOR' as const, codigo: 'OP-001', nome: 'Ana Silva' },
    ]));
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['2']));
    component.atualizarSelecao(new Set(['2', '1']));
    component.prepararBatelada();
  }
});

function context() {
  return {
    workCenter: {
      code: 'CT-EXT-01',
      description: 'Extrusão Linha 01',
      areaCode: '4001',
      area: 'Produção',
      machineGroup: 'Extrusoras',
      establishment: '101',
      active: true,
    },
    operator: { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
    reportType: 'BATCH' as const,
    validity: '2026-07-23',
  };
}

function orders(): ReadonlyArray<OrdemLiberadaBatelada> {
  return [
    { id: '1', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
    { id: '2', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '20', split: '01' },
  ];
}
