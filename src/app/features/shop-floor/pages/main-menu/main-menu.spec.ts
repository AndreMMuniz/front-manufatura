import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

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

  it('non-implemented options do not navigate', () => {
    const fixture = TestBed.createComponent(MainMenuPage);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const unavailable = component.groups[0].options[0];
    expect(unavailable.implemented).toBe(false);

    component.selectOption(unavailable);

    expect(navigateSpy).not.toHaveBeenCalled();
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
