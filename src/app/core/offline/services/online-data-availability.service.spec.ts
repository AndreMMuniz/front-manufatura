import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ConnectivityService } from './connectivity.service';
import { OnlineDataAvailabilityService } from './online-data-availability.service';

describe('OnlineDataAvailabilityService', () => {
  it('usa a resposta real do servidor quando o navegador aparenta estar online', async () => {
    const head = vi.fn().mockReturnValue(throwError(() => new Error('Datasul indisponível')));
    TestBed.configureTestingModule({
      providers: [
        OnlineDataAvailabilityService,
        { provide: HttpClient, useValue: { head } },
        { provide: ConnectivityService, useValue: { onlineHint: true } },
      ],
    });

    const available = await firstValueFrom(TestBed.inject(OnlineDataAvailabilityService).check());

    expect(head).toHaveBeenCalledWith('/api/health');
    expect(available).toBe(false);
  });

  it('não consulta o servidor quando o hint já está offline', async () => {
    const head = vi.fn().mockReturnValue(of(null));
    TestBed.configureTestingModule({
      providers: [
        OnlineDataAvailabilityService,
        { provide: HttpClient, useValue: { head } },
        { provide: ConnectivityService, useValue: { onlineHint: false } },
      ],
    });

    const available = await firstValueFrom(TestBed.inject(OnlineDataAvailabilityService).check());

    expect(head).not.toHaveBeenCalled();
    expect(available).toBe(false);
  });
});
