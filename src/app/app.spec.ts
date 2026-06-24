import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';

import { PoMenuModule, PoPageModule, PoToolbarModule } from '@po-ui/ng-components';

import { App } from './app';
import { routes } from './app.routes';
import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PoToolbarModule, PoMenuModule, PoPageModule, App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should route quality-control to the quality control home page', async () => {
    const harness = await RouterTestingHarness.create();

    const component = await harness.navigateByUrl('/quality-control', QualityControlHome);

    expect(component).toBeInstanceOf(QualityControlHome);
    expect(TestBed.inject(Router).url).toBe('/quality-control');
  });

  it('should redirect root and unknown routes to quality-control', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

    await harness.navigateByUrl('/');
    expect(router.url).toBe('/quality-control');

    await harness.navigateByUrl('/unknown-route');
    expect(router.url).toBe('/quality-control');
  });

  it('should keep the menu entry navigating to quality-control', () => {
    const navigateSpy = vi.fn().mockResolvedValue(true);
    const app = new App({ navigate: navigateSpy } as unknown as Router);

    app.menus[0].action?.(app.menus[0]);

    expect(app.menus[0].label).toBe('Plano Controle CQ');
    expect(navigateSpy).toHaveBeenCalledWith(['/quality-control']);
  });
});
