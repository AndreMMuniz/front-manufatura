import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ConnectivityService } from '../../../../core/offline/services/connectivity.service';
import {
  SynchronizationCenterService,
  SynchronizationCenterState,
} from '../../services/synchronization-center.service';
import { SynchronizationIndicator } from './synchronization-indicator';

describe('SynchronizationIndicator', () => {
  it('expõe conectividade, contagens, atividade, nome acessível e navegação por teclado', async () => {
    const state = new BehaviorSubject<SynchronizationCenterState>({
      ownerId: 'operator-1',
      readState: 'ready',
      items: [],
      counts: { pending: 5, error: 0, syncing: 2, receipts: 0 },
      filters: { statuses: [], modules: [] },
      nextCursor: null,
      hasMore: false,
    });
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [SynchronizationIndicator],
      providers: [
        {
          provide: SynchronizationCenterService,
          useValue: { state$: state.asObservable(), snapshot: state.value },
        },
        {
          provide: ConnectivityService,
          useValue: {
            onlineHint: true,
            changes$: new BehaviorSubject(true),
          },
        },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SynchronizationIndicator);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button');

    expect(button.getAttribute('aria-label')).toContain('Sincronização');
    expect(button.textContent).toContain('Sincronizando — 2 de 5 ativos');
    expect(button.textContent).toContain('5 pendências');
    expect(button.classList).toContain('synchronization-indicator');

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(navigateByUrl).toHaveBeenCalledTimes(2);
    expect(navigateByUrl).toHaveBeenCalledWith('/synchronization');
  });

  it('distingue offline de Datasul atualizado e anuncia mudança sem depender só de cor', async () => {
    const connectivity = new BehaviorSubject(false);
    const state = new BehaviorSubject<SynchronizationCenterState>({
      ownerId: 'operator-1',
      readState: 'ready',
      items: [],
      counts: { pending: 3, error: 0, syncing: 0, receipts: 0 },
      filters: { statuses: [], modules: [] },
      nextCursor: null,
      hasMore: false,
    });
    await TestBed.configureTestingModule({
      imports: [SynchronizationIndicator],
      providers: [
        {
          provide: SynchronizationCenterService,
          useValue: { state$: state.asObservable(), snapshot: state.value },
        },
        {
          provide: ConnectivityService,
          useValue: { onlineHint: false, changes$: connectivity.asObservable() },
        },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SynchronizationIndicator);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Offline — 3 registros aguardando envio',
    );
    const live = fixture.nativeElement.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();

    connectivity.next(true);
    state.next({ ...state.value, counts: { pending: 0, error: 0, syncing: 0, receipts: 1 } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Datasul atualizado');
    expect(fixture.nativeElement.querySelector('po-icon')).not.toBeNull();
  });
});
