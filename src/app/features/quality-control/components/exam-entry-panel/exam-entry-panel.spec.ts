import { ComponentFixture, TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PoDialogService } from '@po-ui/ng-components';

import { OperationalCommandFacade } from '../../../../core/offline/services/operational-command.facade';
import { OperatorService } from '../../../shop-floor/services/operator';
import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';
import { ExamEntryPanel } from './exam-entry-panel';

describe('ExamEntryPanel resultado único', () => {
  let fixture: ComponentFixture<ExamEntryPanel>;
  let component: ExamEntryPanel;
  let state: QualityControlWorkflowState;
  let capture: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    capture = vi.fn(async (request: { idempotencyKey?: string }) => ({
      localId: request.idempotencyKey ?? 'local',
      idempotencyKey: request.idempotencyKey ?? 'idem', payloadHash: 'hash',
      committedAt: new Date().toISOString(), syncStatus: 'PENDING',
    }));
    await TestBed.configureTestingModule({ imports: [ExamEntryPanel], providers: [
      QualityControlWorkflowState, QualityControlService, OperatorService,
      { provide: OperationalCommandFacade, useValue: { capture } },
      { provide: PoDialogService, useValue: { confirm: vi.fn() } },
    ] }).compileComponents();
    state = TestBed.inject(QualityControlWorkflowState);
    state.setGeneratedRoute({ nrFicha: 64379, routeNumber: '64379', processDescription: 'USINAR',
      currentOrder: '372562', operationCode: '20', operationDescription: '20 - USINAR',
      split: '1', itemCode: '30907', itemDescription: '30907' });
    const token = state.beginExamLoad()!;
    state.completeExamLoad(token, [
      { id: 'e1', code: '1845', description: 'E1', version: '1', frequency: '60', sample: '2', unit: '', nqa: '0', level: '0', components: [
        { id: 'numeric', code: '1', examCode: 1845, componentCode: 1, tableNumber: 0,
          decimalPlaces: 2, description: 'Cota', reference: '23,8 - 24,2', minValue: 23.8,
          maxValue: 24.2, unit: 'mm', measurementMethod: 'PAQUÍMETRO', sequence: 1, status: 'PENDING' },
      ] },
      { id: 'e2', code: '1846', description: 'E2', version: '1', frequency: '60', sample: '1', unit: '', nqa: '0', level: '0', components: [
        { id: 'option', code: '3', examCode: 1846, componentCode: 3, tableNumber: 8,
          decimalPlaces: 0, description: 'Visual', reference: '', minValue: 0, maxValue: 0,
          unit: '', sequence: 2, status: 'PENDING', resultOptions: [
            { tableNumber: 8, sequence: 1, description: 'SIM' },
            { tableNumber: 8, sequence: 2, description: 'NÃO' },
          ] },
      ] },
    ]);
    state.openPanel('numeric');
    fixture = TestBed.createComponent(ExamEntryPanel);
    component = fixture.componentInstance;
  });

  it('renderiza somente um campo Resultado para componente numérico', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[name="result"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[name="minimum"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[name="maximum"]')).toBeNull();
  });

  it('registra valor único como RECORDED/PENDING sem aprovação inferida', async () => {
    component.updateResult('24,01');
    await firstValueFrom(component.saveCurrentMeasurement());
    expect(state.componentById('numeric')?.measurement).toMatchObject({
      result: 24.01, status: 'RECORDED', deliveryStatus: 'PENDING',
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'SAVE_QUALITY_RESULT', payload: expect.objectContaining({ resultado: 24.01 }),
    }));
  });

  it('respeita numeroDecimais e bloqueia precisão excedente', async () => {
    component.updateResult('24,001');

    await expect(firstValueFrom(component.saveCurrentMeasurement())).resolves.toBeNull();
    expect(component.validationMessage).toContain('no máximo 2');
    expect(capture).not.toHaveBeenCalled();
  });

  it('preserva resultado numérico negativo', async () => {
    component.updateResult('-1,25');

    await firstValueFrom(component.saveCurrentMeasurement());
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ resultado: -1.25 }),
    }));
  });

  it('exibe o meio de medição retornado pelo roteiro', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('PAQUÍMETRO');
  });

  it('não envia resultado estruturalmente inválido', async () => {
    component.updateResult('-');

    await expect(firstValueFrom(component.saveCurrentMeasurement())).resolves.toBeNull();
    expect(component.validationMessage).toContain('numérico');
    expect(capture).not.toHaveBeenCalled();
  });

  it('mantém a medição bloqueada após o registro local', async () => {
    component.updateResult('24');
    await firstValueFrom(component.saveCurrentMeasurement());

    state.openPanel('numeric');
    component.updateResult('25');
    expect(component.result).toBe('24');
    await expect(firstValueFrom(component.saveCurrentMeasurement())).resolves.toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('preserva o rascunho quando o commit local falha', async () => {
    capture.mockRejectedValueOnce(new Error('indexeddb-unavailable'));
    component.updateResult('24,1');

    await expect(firstValueFrom(component.saveCurrentMeasurement())).resolves.toBeNull();
    expect(component.result).toBe('24,1');
    expect(state.componentById('numeric')?.measurement).toBeUndefined();
  });

  it('bloqueia finalização e exige motivo quando há reprovação remota', () => {
    state.applyMeasurement('e1', 'numeric', {
      result: 24, status: 'REJECTED', withinRange: false, commandId: 'r1',
    });
    state.applyMeasurement('e2', 'option', {
      selectedOption: { tableNumber: 8, sequence: 1, description: 'SIM' },
      status: 'APPROVED', withinRange: true, commandId: 'r2',
    });

    expect(component.canCompleteExam).toBe(false);
    expect(component.showStopRoute).toBe(true);
    component.stopRoute();
    expect(component.stopValidationMessage).toContain('motivo');
  });

  it('usa nrTabela/seqOpcao sem inferir significado textual', async () => {
    state.openPanel('option');
    component.updateSelectedOption('8:2');
    await firstValueFrom(component.saveCurrentMeasurement());
    expect(state.componentById('option')?.measurement).toMatchObject({
      selectedOption: { tableNumber: 8, sequence: 2, description: 'NÃO' }, status: 'RECORDED',
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ nrTabela: 8, seqOpcao: 2 }),
    }));
  });

  it('finaliza a ficha somente após todos os exames e depende de todos os resultados', async () => {
    state.applyMeasurement('e1', 'numeric', { result: 24, status: 'RECORDED', commandId: 'r1' });
    expect(component.canCompleteExam).toBe(false);
    state.applyMeasurement('e2', 'option', { selectedOption: { tableNumber: 8, sequence: 1, description: 'SIM' }, status: 'RECORDED', commandId: 'r2' });
    expect(component.canCompleteExam).toBe(true);
    component.completeExam();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'FINALIZE_QUALITY_ROUTE', aggregateId: '64379', dependencyIds: ['r1', 'r2'],
    })));
  });
});
