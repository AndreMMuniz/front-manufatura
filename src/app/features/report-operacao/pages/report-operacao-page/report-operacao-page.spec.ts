import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoNotificationService } from '@po-ui/ng-components';

import { EstadoOperacao, ReportOperacao } from '../../models/report-operacao.model';
import { ReportOperacaoService } from '../../services/report-operacao.service';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';

import { ReportOperacaoPage } from './report-operacao-page';

describe('ReportOperacaoPage', () => {
  let fixture: ComponentFixture<ReportOperacaoPage>;
  let component: ReportOperacaoPage;
  let reportOperacaoServiceMock: {
    consultarOP: ReturnType<typeof vi.fn>;
    iniciarOperacao: ReturnType<typeof vi.fn>;
    reportarOperacao: ReturnType<typeof vi.fn>;
    validarReporte: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    reportOperacaoServiceMock = {
      consultarOP: vi.fn(() => of({ sucesso: false })),
      iniciarOperacao: vi.fn(),
      reportarOperacao: vi.fn(() => of({ apontamentoId: 'APT-1', reportadoEm: new Date() })),
      validarReporte: vi.fn(() => ''),
    };

    await TestBed.configureTestingModule({
      imports: [ReportOperacaoPage],
      providers: [
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ReportOperacaoService, useValue: reportOperacaoServiceMock },
        { provide: ReporteParadasService, useValue: { setContextFromOperation: vi.fn() } },
        {
          provide: PoNotificationService,
          useValue: {
            success: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            information: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportOperacaoPage);
    component = fixture.componentInstance;
  });

  it('stores the scrap composition and updates operation scrap quantity from the consolidated total', () => {
    component.operacao = baseOperacao();

    component.registrarRefugo({
      quantidade: 2.05,
      motivo: '05 - Borra, 32 - Varredura',
      itens: [
        { codigo: '05', descricao: 'Borra', quantidade: 0.55 },
        { codigo: '32', descricao: 'Varredura', quantidade: 1.5 },
      ],
    });

    expect(component.operacao?.quantidadeRefugo).toBe(2.05);
    expect(component.refugoItens).toEqual([
      { codigo: '05', descricao: 'Borra', quantidade: 0.55 },
      { codigo: '32', descricao: 'Varredura', quantidade: 1.5 },
    ]);
    expect(component.ultimoMotivoRefugo).toBe('05 - Borra, 32 - Varredura');
  });

  it('includes scrap composition in the final operation reporting payload', () => {
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({
      dataInicio: new Date(2026, 5, 30),
      dataFim: new Date(2026, 5, 30),
      horaInicio: '08:00',
      horaFim: '08:30',
      quantidadeAprovada: 1,
      quantidadeRefugo: 2.05,
    });
    component.refugoItens = [
      { codigo: '05', descricao: 'Borra', quantidade: 0.55 },
      { codigo: '32', descricao: 'Varredura', quantidade: 1.5 },
    ];

    component.executarAcaoPrincipal();

    expect(reportOperacaoServiceMock.reportarOperacao).toHaveBeenCalledWith(
      expect.objectContaining({
        quantidadeRefugo: 2.05,
        refugoItens: [
          { codigo: '05', descricao: 'Borra', quantidade: 0.55 },
          { codigo: '32', descricao: 'Varredura', quantidade: 1.5 },
        ],
      }),
    );
  });
});

function baseOperacao(overrides: Partial<ReportOperacao> = {}): ReportOperacao {
  return {
    ordem: '450001',
    op: 'OP-10458',
    split: '01',
    item: 'CORT-1200',
    descricao: 'Riscador profissional para porcelanato',
    unidade: 'PC',
    roteiro: 'MONO-001',
    quantidadeOrdem: 500,
    quantidadeSaldo: 320,
    linha: 'Linha Montagem 02',
    horaInicio: '08:00',
    horaFim: '08:30',
    quantidadeAprovada: 0,
    quantidadeRetrabalho: 0,
    quantidadeRefugo: 0,
    ct: 'CT-ESTAMP-01',
    grupoMaquina: 'Prensas Hidraulicas',
    operador: 'Joao Pereira',
    equipe: 'Equipe A',
    turno: '1o Turno',
    ...overrides,
  };
}
