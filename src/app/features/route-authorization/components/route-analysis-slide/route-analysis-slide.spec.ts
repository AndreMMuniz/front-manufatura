import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  PoDecimalComponent,
  PoDialogService,
  PoPageSlideComponent,
  PoSelectComponent,
  PoTextareaComponent,
} from '@po-ui/ng-components';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingAuthorizedRoute } from '../../models/route-authorization.model';
import { RouteAuthorizationService } from '../../services/route-authorization.service';
import { RouteAnalysisSlide } from './route-analysis-slide';

describe('RouteAnalysisSlide', () => {
  let fixture: ComponentFixture<RouteAnalysisSlide>;
  let component: RouteAnalysisSlide;
  let service: { loadRoute: ReturnType<typeof vi.fn>; saveComponent: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn> };
  let pageSlide: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let dialog: { confirm: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      loadRoute: vi.fn().mockReturnValue(of(loadedRoute())),
      saveComponent: vi.fn(),
      finalize: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [RouteAnalysisSlide],
      providers: [
        provideNoopAnimations(),
        { provide: RouteAuthorizationService, useValue: service },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RouteAnalysisSlide);
    component = fixture.componentInstance;
    pageSlide = fixture.debugElement.query(By.directive(PoPageSlideComponent)).componentInstance;
    vi.spyOn(pageSlide, 'open');
    vi.spyOn(pageSlide, 'close');
    const actualDialog = (component as unknown as { dialog: PoDialogService }).dialog;
    dialog = { confirm: vi.spyOn(actualDialog, 'confirm').mockImplementation(() => undefined) };
  });

  it('abre a ficha, mostra o alerta de autorização e inicia todos os componentes como não verificados', () => {
    component.open(route(), 10);
    fixture.detectChanges();

    expect(service.loadRoute).toHaveBeenCalledWith(route(), 10);
    expect(pageSlide.open).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('A aprovação é confirmada somente pela resposta do Datasul.');
    expect(component.statusFor(component.exams()[0].components[0])).toBe('unverified');
    expect(fixture.nativeElement.textContent).toContain('Não verificado');
    expect(fixture.nativeElement.querySelector('[data-status="unverified"]').getAttribute('aria-live'))
      .toBe('polite');
  });

  it('exibe o controle correspondente para cada tipo de resultado e informa tipo desconhecido', () => {
    component.open(route(), 10);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(PoDecimalComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(PoSelectComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(PoTextareaComponent))).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Tipo de resultado não suportado para salvamento.');
  });

  it('confirma aprovação somente após a resposta remota e bloqueia o componente aprovado', () => {
    const exam = openLoaded(component);
    const numeric = exam.components[0];
    service.saveComponent.mockReturnValue(of(saveResult(true)));

    component.updateResult(numeric, '24,5');
    component.save(exam, numeric);

    expect(service.saveComponent).toHaveBeenCalledWith(64462, 1845, 1, { kind: 'numeric', result: 24.5 });
    expect(component.statusFor(numeric)).toBe('approved');
    expect(component.isLocked(numeric)).toBe(true);
  });

  it('mantém editável e anuncia o retorno textual quando o Datasul informa fora da faixa', () => {
    const exam = openLoaded(component);
    const numeric = exam.components[0];
    service.saveComponent.mockReturnValue(of(saveResult(false)));

    component.updateResult(numeric, '24.5');
    component.save(exam, numeric);
    fixture.detectChanges();

    expect(component.statusFor(numeric)).toBe('out-of-range');
    expect(component.isLocked(numeric)).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-status="out-of-range"]').textContent)
      .toContain('Fora da faixa confirmado pelo Datasul');
  });

  it('preserva o rascunho quando o salvamento falha', () => {
    const exam = openLoaded(component);
    const report = exam.components[2];
    service.saveComponent.mockReturnValue(throwError(() => new Error('network')));

    component.updateReport(report, 'Peça inspecionada visualmente.');
    component.save(exam, report);

    expect(component.statusFor(report)).toBe('error');
    expect(component.draftFor(report)).toMatchObject({ report: 'Peça inspecionada visualmente.' });
    expect(component.statusTextFor(report)).toContain('rascunho foi preservado');
  });

  it('ignora duplo clique enquanto o mesmo componente está salvando', () => {
    const exam = openLoaded(component);
    const numeric = exam.components[0];
    const pending = new Subject<ReturnType<typeof saveResult>>();
    service.saveComponent.mockReturnValue(pending);
    component.updateResult(numeric, '24,5');

    component.save(exam, numeric);
    component.save(exam, numeric);

    expect(service.saveComponent).toHaveBeenCalledOnce();
    expect(component.statusFor(numeric)).toBe('saving');
  });

  it('valida a precisão numérica, opção de tabela e laudo antes de salvar', () => {
    const exam = openLoaded(component);
    const [numeric, table, report, unsupported] = exam.components;

    component.updateResult(numeric, '24,555');
    component.save(exam, numeric);
    component.save(exam, table);
    component.updateReport(report, '   ');
    component.save(exam, report);
    component.save(exam, unsupported);

    expect(service.saveComponent).not.toHaveBeenCalled();
    expect(component.statusTextFor(numeric)).toContain('até 2 casas decimais');
    expect(component.statusTextFor(table)).toContain('opção válida');
    expect(component.statusTextFor(report)).toContain('Informe o laudo');
    expect(component.statusTextFor(unsupported)).toContain('não suportado');
  });

  it('ignora a resposta de carregamento de uma abertura que já foi substituída', () => {
    const first = new Subject<ReturnType<typeof loadedRoute>>();
    const second = new Subject<ReturnType<typeof loadedRoute>>();
    service.loadRoute.mockReturnValueOnce(first).mockReturnValueOnce(second);

    component.open(route(), 10);
    component.open({ ...route(), sheetNumber: 64463 }, 20);
    first.next(loadedRoute());
    second.next({ ...loadedRoute(), route: { ...loadedRoute().route, nrFicha: 64463 } });

    expect(component.route()?.nrFicha).toBe(64463);
  });

  it('pede confirmação antes de descartar um rascunho e avisa o fechamento', () => {
    const exam = openLoaded(component);
    const closed = vi.fn();
    component.analysisClosed.subscribe(closed);
    component.updateResult(exam.components[0], '24,5');

    component.requestClose();

    expect(dialog.confirm).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    const confirmation = dialog.confirm.mock.calls[0][0].confirm as () => void;
    confirmation();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('bloqueia o fechamento enquanto salva um componente', () => {
    const exam = openLoaded(component);
    const pending = new Subject<ReturnType<typeof saveResult>>();
    service.saveComponent.mockReturnValue(pending);
    component.updateResult(exam.components[0], '24,5');
    component.save(exam, exam.components[0]);

    component.requestClose();

    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(component.feedback()).toContain('Aguarde a operação');
  });

  it('emite a finalização remota e fecha somente quando ela é confirmada', () => {
    service.loadRoute.mockReturnValue(of(loadedRouteWithSupportedComponents()));
    const exam = openLoaded(component);
    const outcome = {
      sheetNumber: 64462, finalized: true as const, inspected: true, totalComponents: 4,
      savedComponents: 4, pendingComponents: 0, outOfRangeComponents: 1, statusCode: 4,
      message: 'Ficha finalizada', exams: [],
    };
    service.saveComponent.mockReturnValue(of(saveResult(true)));
    for (const componentModel of exam.components) {
      if (componentModel.resultType === 1) component.updateResult(componentModel, '24,5');
      if (componentModel.resultType === 2) component.updateSelectedOption(componentModel, '8:1');
      if (componentModel.resultType === 3) component.updateReport(componentModel, 'Conforme');
      component.save(exam, componentModel);
    }
    service.finalize.mockReturnValue(of(outcome));
    const finalized = vi.fn();
    component.routeFinalized.subscribe(finalized);

    component.finalizeRoute();

    expect(service.finalize).toHaveBeenCalledWith(64462);
    expect(finalized).toHaveBeenCalledWith(outcome);
    expect(pageSlide.close).toHaveBeenCalledOnce();
  });
});

function openLoaded(component: RouteAnalysisSlide) {
  component.open(route(), 10);
  return component.exams()[0];
}

function route(): PendingAuthorizedRoute {
  return {
    sheetNumber: 64462,
    productionOrderNumber: 372562,
    itemCode: '30907',
    itemDescription: 'ALAVANCA',
    operationSequence: 1,
    statusCode: 2,
    released: false,
    inspected: false,
    totalComponents: 4,
    outOfRangeComponents: 1,
    narrative: 'Componente pendente da autorização',
  };
}

function loadedRoute() {
  const components = [
    component(1, 1, 'Numérico'),
    component(2, 2, 'Tabela', { tableNumber: 8, resultOptions: [
      { tableNumber: 8, sequence: 1, description: 'Conforme' },
    ] }),
    component(3, 3, 'Laudo'),
    component(4, 99, 'Desconhecido'),
  ];
  const exams = [{
    id: '64462-1845', code: '1845', description: 'Dimensional', version: '1', frequency: '1',
    sample: '1', unit: '', nqa: '0', level: '0', components,
  }];
  return {
    route: {
      nrFicha: 64462, routeNumber: '64462', processDescription: '', currentOrder: '372562',
      operationCode: '10', operationDescription: '', split: '1', itemCode: '30907',
      itemDescription: 'ALAVANCA', exams,
    },
    exams,
  };
}

function loadedRouteWithSupportedComponents() {
  const loaded = loadedRoute();
  const exams = [{ ...loaded.exams[0], components: loaded.exams[0].components.slice(0, 3) }];
  return { route: { ...loaded.route, exams }, exams };
}

function component(
  componentCode: number,
  resultType: number,
  description: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `64462-1845-${componentCode}`,
    code: String(componentCode),
    examCode: 1845,
    componentCode,
    description,
    reference: '20 - 30',
    minValue: 20,
    maxValue: 30,
    unit: 'MM',
    sequence: componentCode,
    resultType,
    decimalPlaces: 2,
    resultOptions: [],
    status: 'PENDING' as const,
    ...overrides,
  };
}

function saveResult(withinRange: boolean) {
  return {
    sheetNumber: 64462,
    examCode: 1845,
    componentCode: 1,
    withinRange,
    savedComponents: 2,
    totalComponents: 6,
  };
}
