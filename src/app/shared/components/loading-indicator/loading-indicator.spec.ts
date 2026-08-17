import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoadingIndicator } from './loading-indicator';

describe('LoadingIndicator', () => {
  let fixture: ComponentFixture<LoadingIndicator>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LoadingIndicator] }).compileComponents();
    fixture = TestBed.createComponent(LoadingIndicator);
    fixture.componentRef.setInput('text', 'Consultando ordens...');
    fixture.detectChanges();
  });

  it('renders a compact accessible indeterminate progress bar', () => {
    const element = fixture.nativeElement as HTMLElement;
    const status = element.querySelector('[role="status"]');
    const progressbar = element.querySelector('[role="progressbar"]');

    expect(status?.textContent).toContain('Consultando ordens...');
    expect(progressbar?.getAttribute('aria-label')).toBe('Consultando ordens...');
    expect(progressbar?.getAttribute('aria-valuetext')).toBe('Em andamento');
    expect(element.querySelector('po-loading')).toBeNull();
  });
});
