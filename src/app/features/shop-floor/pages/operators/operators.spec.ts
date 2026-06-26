import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Operator } from '../../models/operator';
import { OperatorService } from '../../services/operator';
import { OperatorsPage } from './operators';

describe('OperatorsPage', () => {
  const operators: Operator[] = [
    { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
    { code: 'OP-002', name: 'Bruno Costa', role: 'Operador', active: true },
    { code: 'OP-003', name: 'Carla Dias', role: 'Supervisor', active: true },
    { code: 'OP-004', name: 'Diego Souza', role: 'Inspetor', active: false },
  ];

  let fixture: ComponentFixture<OperatorsPage>;
  let component: OperatorsPage;
  let routerMock: Router;
  let serviceMock: OperatorService;

  beforeEach(async () => {
    routerMock = { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
    serviceMock = {
      listOperators: vi.fn().mockReturnValue(of(operators)),
      searchOperators: vi.fn((term: string) =>
        of(operators.filter(operator => `${operator.code} ${operator.name} ${operator.role}`.toLowerCase().includes(term.toLowerCase()))),
      ),
      selectOperator: vi.fn((code: string) => of(operators.find(operator => operator.code === code && operator.active) ?? null)),
      clearSelection: vi.fn(),
      selectedOperator: null,
    } as unknown as OperatorService;

    await TestBed.configureTestingModule({
      imports: [OperatorsPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: OperatorService, useValue: serviceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OperatorsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads the initial operator list', () => {
    expect(component).toBeTruthy();
    expect(serviceMock.listOperators).toHaveBeenCalled();
    expect(component.operators).toEqual(operators);
  });

  it('filters operators by the current search term', () => {
    component.searchTerm = 'silva';

    component.search();

    expect(serviceMock.searchOperators).toHaveBeenCalledWith('silva');
    expect(component.operators).toEqual([operators[0]]);
  });

  it('selects an active operator and shows the selection summary', () => {
    component.selectOperator(operators[0]);

    expect(serviceMock.selectOperator).toHaveBeenCalledWith('OP-001');
    expect(component.selectedOperator).toEqual(operators[0]);
  });

  it('does not select inactive operators', () => {
    component.selectOperator(operators[3]);

    expect(component.selectedOperator).toBeNull();
  });

  it('clears the current operator selection', () => {
    component.selectedOperator = operators[1];

    component.clearSelection();

    expect(serviceMock.clearSelection).toHaveBeenCalled();
    expect(component.selectedOperator).toBeNull();
  });

  it('navigates back to the main menu', () => {
    component.backToMenu();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/menu']);
  });

  it('does not submit the search form when navigating back to the main menu', () => {
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('po-button')) as Array<HTMLElement>;
    const backButton = buttons.find(button => button.textContent?.includes('Voltar ao Menu'));

    expect(backButton?.getAttribute('p-type') ?? backButton?.getAttribute('ng-reflect-p-type')).toBe('button');
  });

  it('renders operator status and selected context', () => {
    component.selectedOperator = operators[0];
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.textContent).toContain('OP-001');
    expect(native.textContent).toContain('Ativo');
    expect(native.textContent).toContain('Operador selecionado');
  });
});