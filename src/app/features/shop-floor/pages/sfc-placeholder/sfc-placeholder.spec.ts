import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';

import { SfcPlaceholderPage } from './sfc-placeholder';
import { ConnectivityService } from '../../../../core/offline/services/connectivity.service';
import { OnlineDataAvailabilityService } from '../../../../core/offline/services/online-data-availability.service';

describe('SfcPlaceholderPage', () => {
  let fixture: ComponentFixture<SfcPlaceholderPage>;
  let component: SfcPlaceholderPage;
  let routerMock: Router;
  let connectivityMock: { onlineHint: boolean; changes$: BehaviorSubject<boolean> };
  let serverAvailable: boolean;

  beforeEach(async () => {
    routerMock = { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
    connectivityMock = { onlineHint: true, changes$: new BehaviorSubject(true) };
    serverAvailable = true;

    await TestBed.configureTestingModule({
      imports: [SfcPlaceholderPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: ConnectivityService, useValue: connectivityMock },
        {
          provide: OnlineDataAvailabilityService,
          useValue: { check: vi.fn(() => of(serverAvailable && connectivityMock.onlineHint)) },
        },
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
                requiresOnlineData: true,
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
    const pageTitle = fixture.debugElement.query(By.css('po-page-default')).componentInstance.title;
    const widgetTitle = fixture.debugElement.query(By.css('po-widget')).componentInstance.title;

    expect(native.textContent).toContain('Reporte de Operações');
    expect(native.textContent?.match(/Reporte de Operações/g)).toHaveLength(1);
    expect(pageTitle).toBe('Reporte de Operações');
    expect(widgetTitle).toBeFalsy();
    expect(native.textContent).toContain('Este módulo está pendente de implementação');
    expect(native.textContent).toContain('Fluxos de reporte de produção serão implementados em uma etapa futura.');
  });

  it('navigates back to the default actionable module', () => {
    component.backToDefaultModule();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/quality-control']);
  });

  it('keeps the back button as type button', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('po-button')) as Array<HTMLElement>;
    const backButton = buttons.find(button => button.textContent?.includes('Voltar ao Plano Controle CQ'));

    expect(backButton?.getAttribute('p-type') ?? backButton?.getAttribute('ng-reflect-p-type')).toBe('button');
  });

  it('não inventa consulta ausente quando o indicativo está offline', () => {
    fixture.destroy();
    connectivityMock.onlineHint = false;
    fixture = TestBed.createComponent(SfcPlaceholderPage);
    fixture.detectChanges();
    fixture.componentInstance.refreshAvailability();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Dados não disponíveis neste dispositivo. Conecte-se para consultar o Datasul.',
    );
  });

  it('mostra indisponibilidade quando o Datasul falha mesmo com navegador online', () => {
    serverAvailable = false;
    component.refreshAvailability();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Dados não disponíveis neste dispositivo. Conecte-se para consultar o Datasul.',
    );
  });
});
