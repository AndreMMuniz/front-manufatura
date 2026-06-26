import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SfcPlaceholderPage } from './sfc-placeholder';

describe('SfcPlaceholderPage', () => {
  let fixture: ComponentFixture<SfcPlaceholderPage>;
  let component: SfcPlaceholderPage;
  let routerMock: Router;

  beforeEach(async () => {
    routerMock = { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;

    await TestBed.configureTestingModule({
      imports: [SfcPlaceholderPage],
      providers: [
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({
              title: 'Reporte de Operações',
              description: 'Fluxos de reporte de produção serão implementados em uma etapa futura.',
            }),
            snapshot: {
              data: {
                title: 'Reporte de Operações',
                description: 'Fluxos de reporte de produção serão implementados em uma etapa futura.',
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SfcPlaceholderPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and reads placeholder copy from route data', () => {
    expect(component).toBeTruthy();
    expect(component.title).toBe('Reporte de Operações');
    expect(component.description).toBe('Fluxos de reporte de produção serão implementados em uma etapa futura.');
  });

  it('renders the title, pending message and route description', () => {
    const native = fixture.nativeElement as HTMLElement;

    expect(native.textContent).toContain('Reporte de Operações');
    expect(native.textContent).toContain('Este módulo está pendente de implementação');
    expect(native.textContent).toContain('Fluxos de reporte de produção serão implementados em uma etapa futura.');
  });

  it('navigates back to the main menu', () => {
    component.backToMenu();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/menu']);
  });

  it('keeps the back button as type button', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('po-button')) as Array<HTMLElement>;
    const backButton = buttons.find(button => button.textContent?.includes('Voltar ao Menu'));

    expect(backButton?.getAttribute('p-type') ?? backButton?.getAttribute('ng-reflect-p-type')).toBe('button');
  });
});
