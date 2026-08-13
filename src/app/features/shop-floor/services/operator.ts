import { Injectable, Optional } from '@angular/core';
import { Observable, map } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { Operator } from '../models/operator';

@Injectable({ providedIn: 'root' })
export class OperatorService {
  private selected: Operator | null = null;

  constructor(
    private readonly api: AuthenticatedApiService,
    @Optional() authSession?: AuthSessionService,
  ) {
    authSession?.session$.subscribe(session => {
      if (session === null) {
        this.clearSelection();
      }
    });
  }

  get selectedOperator(): Operator | null {
    return this.selected;
  }

  isOperatorRequired(): boolean {
    return true;
  }

  listOperators(): Observable<ReadonlyArray<Operator>> {
    return this.api.get<ReadonlyArray<Operator>>('/api/operators', { active: true });
  }

  searchOperators(term: string): Observable<ReadonlyArray<Operator>> {
    const normalizedTerm = this.normalize(term);

    if (!normalizedTerm) {
      return this.listOperators();
    }

    return this.api.get<ReadonlyArray<Operator>>('/api/operators', {
      term: normalizedTerm,
      active: true,
    });
  }

  selectOperator(code: string): Observable<Operator | null> {
    return this.api.get<ReadonlyArray<Operator>>('/api/operators', {
      term: code,
      active: true,
    }).pipe(map(operators => {
      const selected = operators.find(operator => operator.code === code && operator.active) ?? null;
      this.selected = selected;
      return selected;
    }));
  }

  clearSelection(): void {
    this.selected = null;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
