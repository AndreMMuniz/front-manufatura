import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { PoButtonComponent, PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { MainMenuPage } from './main-menu';

describe('MainMenuPage', () => {
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PoButtonModule, PoPageModule, PoWidgetModule, MainMenuPage],
      providers: [provideRouter([])],
    }).compileComponents();

    navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders one po-widget per group', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    const widgets = native.querySelectorAll('po-widget');

    expect(widgets.length).toBe(fixture.componentInstance.groups.length);
    expect(widgets.length).toBe(3);
  });

  it('exposes groups Produção, Apontamento and Administração', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const labels = fixture.componentInstance.groups.map(g => g.label);
    expect(labels).toEqual(['Produção', 'Apontamento', 'Administração']);
  });

  it('Plano Controle CQ (Apontamento) navigates to /quality-control', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const cq = component.groups[1].options.find(o => o.label === 'Plano Controle CQ');
    expect(cq).toBeDefined();

    component.selectOption(cq!);

    expect(navigateSpy).toHaveBeenCalledWith(['/quality-control']);
  });

  it('Plano Controle CQ (Administração) also navigates to /quality-control', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const cq = component.groups[2].options.find(o => o.label === 'Plano Controle CQ');
    expect(cq).toBeDefined();

    component.selectOption(cq!);

    expect(navigateSpy).toHaveBeenCalledWith(['/quality-control']);
  });

  it('Centro de Trabalho navigates to /work-center', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const workCenter = component.groups[2].options.find(o => o.label === 'Centro de Trabalho');
    expect(workCenter).toBeDefined();

    component.selectOption(workCenter!);

    expect(navigateSpy).toHaveBeenCalledWith(['/work-center']);
  });

  it('Operador navigates to /operators', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const operador = component.groups[2].options.find(o => o.label === 'Operador');
    expect(operador).toBeDefined();

    component.selectOption(operador!);

    expect(navigateSpy).toHaveBeenCalledWith(['/operators']);
  });

  it.each([
    ['Equipes', '/teams'],
    ['Reporte Operações', '/operation-reporting'],
    ['Reporte Paradas', '/stoppages'],
    ['Apontar Refugo / Retrabalho', '/scrap-rework'],
    ['Consulta Item', '/item-consultation'],
  ])('%s navigates to its placeholder route', (label, target) => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const option = component.groups.flatMap(g => g.options).find(o => o.label === label);
    expect(option).toBeDefined();

    component.selectOption(option!);

    expect(navigateSpy).toHaveBeenCalledWith([target]);
  });

  it('all SFC menu options are available after placeholder routing is added', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.directive(PoButtonComponent));

    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.componentInstance.disabled).toBe(false);
      expect(button.nativeElement.getAttribute('title')).not.toContain('não disponível');
    }
  });

  it('renders one po-button per option across all groups', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    const buttons = native.querySelectorAll('po-button');

    const totalOptions = fixture.componentInstance.groups.reduce(
      (sum, g) => sum + g.options.length,
      0,
    );

    expect(buttons.length).toBe(totalOptions);
  });
});
