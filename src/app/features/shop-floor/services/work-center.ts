import { Injectable, Optional } from '@angular/core';
import { Observable, of } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { WorkCenter } from '../models/work-center';

const WORK_CENTERS: ReadonlyArray<WorkCenter> = Object.freeze([
  {
    code: 'CT-EXT-01',
    description: 'Extrusao Linha 01',
    area: 'Producao',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  },
  {
    code: 'CT-CQ-01',
    description: 'Controle de Qualidade',
    area: 'Qualidade',
    machineGroup: 'Qualidade',
    establishment: '101',
    active: true,
  },
  {
    code: 'CT-MNT-01',
    description: 'Manutencao',
    area: 'Apoio',
    machineGroup: 'Manutencao',
    establishment: '102',
    active: false,
  },
]);

@Injectable({ providedIn: 'root' })
export class WorkCenterService {
  private selected: WorkCenter | null = null;

  constructor(@Optional() authSession?: AuthSessionService) {
    authSession?.session$.subscribe(session => {
      if (session === null) {
        this.clearSelection();
      }
    });
  }

  get selectedWorkCenter(): WorkCenter | null {
    return this.selected;
  }

  listWorkCenters(): Observable<ReadonlyArray<WorkCenter>> {
    return of(WORK_CENTERS);
  }

  searchWorkCenters(term: string): Observable<ReadonlyArray<WorkCenter>> {
    const normalizedTerm = this.normalize(term);

    if (!normalizedTerm) {
      return this.listWorkCenters();
    }

    return of(
      WORK_CENTERS.filter(center =>
        this.normalize(`${center.code} ${center.description} ${center.area}`).includes(normalizedTerm),
      ),
    );
  }

  findWorkCenter(code: string): Observable<WorkCenter | null> {
    const normalizedCode = this.normalize(code);
    const found = WORK_CENTERS.find(center => this.normalize(center.code) === normalizedCode && center.active) ?? null;

    return of(found);
  }

  selectWorkCenter(code: string): Observable<WorkCenter | null> {
    const normalizedCode = this.normalize(code);
    const selected = WORK_CENTERS.find(center => this.normalize(center.code) === normalizedCode && center.active) ?? null;
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
