import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';

import { FooterAcoesBatelada } from './footer-acoes-batelada';

describe('FooterAcoesBatelada', () => {
  it('renders only the available batch actions with independent states', () => {
    const fixture = TestBed.createComponent(FooterAcoesBatelada);
    fixture.componentRef.setInput('startDisabled', true);
    fixture.componentRef.setInput('reportDisabled', false);
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('po-button'));

    expect(buttons.map(button => button.componentInstance.label())).toEqual(['Iniciar', 'Reporte', 'Sair']);
    expect(buttons[0].componentInstance.disabled).toBe(true);
    expect(buttons[1].componentInstance.disabled).toBe(false);
  });

  it('emits the output associated with each rendered button', () => {
    const fixture = TestBed.createComponent(FooterAcoesBatelada);
    fixture.componentRef.setInput('startDisabled', false);
    fixture.componentRef.setInput('reportDisabled', false);
    fixture.detectChanges();

    const start = vi.fn();
    const report = vi.fn();
    const sair = vi.fn();
    fixture.componentInstance.start.subscribe(start);
    fixture.componentInstance.report.subscribe(report);
    fixture.componentInstance.sair.subscribe(sair);

    const buttons = fixture.debugElement.queryAll(By.css('po-button'));
    buttons.forEach(button => button.componentInstance.onClick());

    expect(start).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
    expect(sair).toHaveBeenCalledOnce();
  });
});
