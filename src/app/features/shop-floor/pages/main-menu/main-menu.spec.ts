import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { APP_MODULE_NAVIGATION } from '../../../../core/navigation/app-navigation';
import { MainMenuPage } from './main-menu';

describe('MainMenuPage', () => {
  let fixture: ComponentFixture<MainMenuPage>;
  let component: MainMenuPage;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainMenuPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MainMenuPage);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('creates and exposes the shared module navigation', () => {
    expect(component).toBeTruthy();
    expect(component.modules).toBe(APP_MODULE_NAVIGATION);
  });

  it('renders the heading and only the approved semantic links in order', () => {
    const native = fixture.nativeElement as HTMLElement;
    const links = Array.from(native.querySelectorAll<HTMLAnchorElement>('.main-menu__card'));

    expect(native.textContent).toContain('Menu Principal');
    expect(links).toHaveLength(APP_MODULE_NAVIGATION.length);
    expect(links.map(link => link.textContent?.trim())).toEqual(APP_MODULE_NAVIGATION.map(item => item.label));
    expect(links.map(link => link.getAttribute('href'))).toEqual(APP_MODULE_NAVIGATION.map(item => item.route));
    expect(links.some(link => link.textContent?.includes('Sair'))).toBe(false);
  });

  it('renders the approved decorative icon in each named link', () => {
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.main-menu__card'),
    );

    links.forEach((link, index) => {
      const item = APP_MODULE_NAVIGATION[index];
      const icon = link.querySelector('po-icon');

      expect(link.textContent?.trim()).toBe(item.label);
      expect(icon?.getAttribute('p-icon') ?? icon?.getAttribute('ng-reflect-p-icon')).toBe(item.icon);
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('uses Space to navigate through Angular Router and prevents page scrolling', () => {
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const firstLink = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.main-menu__card');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

    firstLink?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigateByUrl).toHaveBeenCalledWith(APP_MODULE_NAVIGATION[0].route);
  });

  it('handles a rejected Space navigation without propagating the error', async () => {
    vi.spyOn(router, 'navigateByUrl').mockRejectedValue(new Error('navigation failed'));
    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true });

    expect(() => component.navigateWithSpace(event, APP_MODULE_NAVIGATION[0].route)).not.toThrow();
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
  });
});
