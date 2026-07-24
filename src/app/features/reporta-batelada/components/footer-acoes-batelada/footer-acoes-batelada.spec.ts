import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';

import { FooterAcoesBatelada } from './footer-acoes-batelada';

describe('FooterAcoesBatelada', () => {
  it('renders explicit batch actions with independent states and outputs', () => {
    const fixture = TestBed.createComponent(FooterAcoesBatelada);
    fixture.componentRef.setInput('startDisabled', true);
    fixture.componentRef.setInput('reportDisabled', false);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const start = vi.fn();
    const report = vi.fn();
    component.start.subscribe(start);
    component.report.subscribe(report);

    const buttons = fixture.debugElement.queryAll(By.css('po-button'));
    expect(buttons.map(button => button.componentInstance.label())).toEqual(['Iniciar', 'Reporte', 'Sair']);
    expect(buttons[0].componentInstance.disabled).toBe(true);
    expect(buttons[1].componentInstance.disabled).toBe(false);

    component.start.emit();
    component.report.emit();
    expect(start).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
  });
});
