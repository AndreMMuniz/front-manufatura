import { Injectable, Optional } from '@angular/core';
import { Observable, of } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { Operator } from '../models/operator';

const OPERATORS: ReadonlyArray<Operator> = Object.freeze([
  { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
  { code: 'OP-002', name: 'Bruno Costa', role: 'Operador', active: true },
  { code: 'OP-003', name: 'Carla Dias', role: 'Supervisor', active: true },
  { code: 'OP-004', name: 'Diego Souza', role: 'Inspetor', active: false },
]);

@Injectable({ providedIn: 'root' })
export class OperatorService {
  private selected: Operator | null = null;

  constructor(@Optional() authSession?: AuthSessionService) {
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
    return of(OPERATORS);
  }

  searchOperators(term: string): Observable<ReadonlyArray<Operator>> {
    const normalizedTerm = this.normalize(term);

    if (!normalizedTerm) {
      return this.listOperators();
    }

    return of(
      OPERATORS.filter(operator =>
        this.normalize(`${operator.code} ${operator.name} ${operator.role}`).includes(normalizedTerm),
      ),
    );
  }

  selectOperator(code: string): Observable<Operator | null> {
    const selected = OPERATORS.find(operator => operator.code === code && operator.active) ?? null;
    this.selected = selected;
    return of(selected);
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