import { Injectable, Optional } from '@angular/core';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OperationalContext } from '../models/operational-context';

@Injectable({ providedIn: 'root' })
export class OperationalContextService {
  private current: OperationalContext | null = null;

  constructor(@Optional() authSession?: AuthSessionService) {
    authSession?.session$.subscribe(session => {
      if (session === null) {
        this.clearContext();
      }
    });
  }

  get currentContext(): OperationalContext | null {
    return this.current;
  }

  setContext(context: OperationalContext): void {
    this.current = context;
  }

  clearContext(): void {
    this.current = null;
  }
}
