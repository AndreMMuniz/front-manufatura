import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PoDialogService } from '@po-ui/ng-components';

import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';
import { InspectionSection } from './inspection-section';

describe('InspectionSection estados local/remoto', () => {
  let fixture: ComponentFixture<InspectionSection>;
  let state: QualityControlWorkflowState;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InspectionSection], providers: [
      QualityControlWorkflowState,
      { provide: PoDialogService, useValue: { confirm: vi.fn() } },
    ] }).compileComponents();
    state = TestBed.inject(QualityControlWorkflowState);
    state.setGeneratedRoute({ nrFicha: 64379, routeNumber: '64379', processDescription: 'P',
      currentOrder: '372562', operationCode: '20', operationDescription: 'P', split: '1',
      itemCode: '30907', itemDescription: '30907' });
    const token = state.beginExamLoad()!;
    state.completeExamLoad(token, [{ id: 'e1', code: '1845', description: 'E', version: '1',
      frequency: '60', sample: '1', unit: '', nqa: '0', level: '0', components: [
        { id: 'c1', code: '1', description: 'Cota', reference: '', minValue: 0, maxValue: 10,
          unit: 'mm', sequence: 1, status: 'PENDING' },
      ] }]);
    fixture = TestBed.createComponent(InspectionSection);
  });

  it('mostra registro local pendente sem chamá-lo de aprovado', () => {
    state.applyMeasurement('e1', 'c1', { result: 5, status: 'RECORDED', deliveryStatus: 'PENDING' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Registrado localmente — envio pendente');
    expect(fixture.nativeElement.textContent).toContain('Resultado: 5');
    expect(fixture.nativeElement.textContent).not.toContain('Aprovado');
  });

  it('usa dentroFaixa remoto como única decisão funcional', () => {
    state.applyMeasurement('e1', 'c1', { result: 5, status: 'APPROVED', deliveryStatus: 'SYNCED', withinRange: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Aprovado');
    state.applyMeasurement('e1', 'c1', { result: 5, status: 'REJECTED', deliveryStatus: 'SYNCED', withinRange: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reprovado pelo Datasul');
  });

  it('mostra frequência e fallback de observação do exame', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Frequência: 01:00 h');
    expect(fixture.nativeElement.textContent).toContain('Observação do Exame: -');
  });

  it('formata resultado e data de apontamento em pt-BR', () => {
    state.applyMeasurement('e1', 'c1', {
      result: 5.25, status: 'APPROVED', deliveryStatus: 'SYNCED', withinRange: true,
      savedAt: new Date(2026, 7, 8, 14, 5),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Resultado: 5,25');
    expect(fixture.nativeElement.textContent).toContain('Apontado 08/08 14:05');
  });

  it('abre o componente selecionado sem alterar o roteiro', () => {
    const component = fixture.componentInstance;
    const routeBefore = state.route();

    component.openExamEntry();

    expect(state.panelOpen()).toBe(true);
    expect(state.route()).toBe(routeBefore);
  });
});
