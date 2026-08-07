import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';

import { ConnectivityService } from './connectivity.service';

@Injectable({ providedIn: 'root' })
export class OnlineDataAvailabilityService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);

  check(): Observable<boolean> {
    if (!this.connectivity.onlineHint) {
      return of(false);
    }

    return this.http.head('/api/health').pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }
}
