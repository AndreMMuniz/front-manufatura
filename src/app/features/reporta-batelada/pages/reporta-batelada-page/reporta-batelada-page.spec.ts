import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoNotificationService } from '@po-ui/ng-components';

import { OperationalContext } from '../../../shop-floor/models/operational-context';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { EstadoBatelada } from '../../models/reporta-batelada.model';
import { ReportaBateladaService } from '../../services/reporta-batelada.service';

import { ReportaBateladaPage } from './reporta-batelada-page';

describe('ReportaBateladaPage', () => {
  let fixture: ComponentFixture<ReportaBateladaPage>;
  let component: ReportaBateladaPage;
  let serviceMock: {
    loadBatch: ReturnType<typeof vi.fn>;
    startBatch: ReturnType<typeof vi.fn>;
    reportBatch: ReturnType<typeof vi.fn>;
    validarInicio: ReturnType<typeof vi.fn>;
    validarReporte: ReturnType<typeof vi.fn>;
    toStartRequest: ReturnType<typeof vi.fn>;
    toReportRequest: ReturnType<typeof vi.fn>;
  };
  let routerMock: { navigate: ReturnType<typeof vi.fn> };
  let reporteParadasServiceMock: { setContextFromBatch: ReturnType<typeof vi.fn> };
  let currentContext: OperationalContext | null;

  beforeEach(async () => {
    currentContext = context();
    serviceMock = {
      loadBatch: vi.fn(() => of(batch())),
      startBatch: vi.fn(() => of({ dataInicio: new Date(2026, 6, 3), horaInicio: '08:00' })),
      reportBatch: vi.fn(() => of({ apontamentoId: 'BAT-APT-1', reportadoEm: new Date() })),
      validarInicio: vi.fn(() => ''),
      validarReporte: vi.fn(() => ''),
      toStartRequest: vi.fn(state => ({ batchId: state.id, itemIds: ['1'] })),
      toReportRequest: vi.fn(state => ({ batchId: state.id, items: [] })),
    };
    routerMock = { navigate: vi.fn().mockResolvedValue(true) };
    reporteParadasServiceMock = { setContextFromBatch: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ReportaBateladaPage],
      providers: [
        { provide: ReportaBateladaService, useValue: serviceMock },
        { provide: Router, useValue: routerMock },
        { provide: OperationalContextService, useValue: { get currentContext() { return currentContext; } } },
        { provide: ReporteParadasService, useValue: reporteParadasServiceMock },
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

  it('loads a batch from the operational context', () => {
    expect(serviceMock.loadBatch).toHaveBeenCalled();
    expect(component.batelada?.code).toBe('BAT-001');
    expect(component.estado).toBe(EstadoBatelada.Carregada);
  });

  it('loads a menu-accessible batch when opened without operational context', () => {
    currentContext = null;
    fixture = TestBed.createComponent(ReportaBateladaPage);
    component = fixture.componentInstance;

    fixture.detectChanges();

    expect(serviceMock.loadBatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reportType: 'BATCH',
        workCenter: expect.objectContaining({ code: 'CT-EXT-01' }),
        operator: expect.objectContaining({ code: 'OP-001' }),
      }),
    );
    expect(routerMock.navigate).not.toHaveBeenCalledWith(['/work-center']);
    expect(component.batelada?.code).toBe('BAT-001');
  });

  it('starts selected batch items and switches the primary action to report', () => {
    component.executarAcaoPrincipal();

    expect(serviceMock.startBatch).toHaveBeenCalled();
    expect(component.primaryLabel).toBe('Reportar');
    expect(component.estado).toBe(EstadoBatelada.ProducaoIniciada);
  });

  it('reports the started batch and returns to work center', () => {
    component.estado = EstadoBatelada.ProducaoIniciada;

    component.executarAcaoPrincipal();

    expect(serviceMock.toReportRequest).toHaveBeenCalled();
    expect(serviceMock.reportBatch).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/work-center']);
  });

  it('updates the consolidated scrap quantity without changing batch items', () => {
    const originalItems = component.batelada?.itens;

    component.registrarRefugo({
      quantidade: 1.25,
      motivo: '05 - Borra',
      itens: [{ codigo: '05', descricao: 'Borra', quantidade: 1.25 }],
    });

    expect(component.batelada?.quantidadeRefugo).toBe(1.25);
    expect(component.batelada?.itens).toBe(originalItems);
    expect(component.refugoItens).toEqual([{ codigo: '05', descricao: 'Borra', quantidade: 1.25 }]);
  });

  it('opens stoppages with batch context and keeps report mode enabled', () => {
    component.estado = EstadoBatelada.ProducaoIniciada;

    component.abrirParada();

    expect(reporteParadasServiceMock.setContextFromBatch).toHaveBeenCalledWith(component.batelada);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/stoppages']);
    expect(component.primaryLabel).toBe('Reportar');
    expect(component.canEditProduction).toBe(true);
  });
});

function context() {
  return {
    workCenter: {
      code: 'CT-EXT-01',
      description: 'Extrusao Linha 01',
      area: 'Producao',
      machineGroup: 'Extrusoras',
      establishment: '101',
      active: true,
    },
    operator: { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
    reportType: 'BATCH' as const,
    validity: '2026-07-03',
  };
}

function batch() {
  return {
    id: 'BAT-001',
    code: 'BAT-001',
    description: 'Batelada mock',
    estado: EstadoBatelada.Carregada,
    horaInicio: '',
    horaFim: '',
    quantidadeRefugo: 0,
    quantidadeRetrabalho: 0,
    productionInfo: {
      ct: 'CT-EXT-01',
      gm: 'Extrusoras',
      operatorId: 'OP-001',
      operatorName: 'Ana Silva',
      teamName: 'Equipe A',
      shift: '1o Turno',
    },
    itens: [
      { opId: '1', opNumber: 'OP-1', orderNumber: '450001', productDescription: 'Produto A', quantity: 1, selected: true },
    ],
  };
}
