import { Injectable, Optional } from '@angular/core';
import { Observable, map } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { WorkCenter } from '../models/work-center';

@Injectable({ providedIn: 'root' })
export class WorkCenterService {
  private selected: WorkCenter | null = null;

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

  get selectedWorkCenter(): WorkCenter | null {
    return this.selected;
  }

  listWorkCenters(): Observable<ReadonlyArray<WorkCenter>> {
    return this.api.get<ReadonlyArray<WorkCenter>>('/api/work-centers', { active: true }).pipe(
      map(centers => this.cloneCenters(centers)),
    );
  }

  searchWorkCenters(term: string): Observable<ReadonlyArray<WorkCenter>> {
    const normalizedTerm = this.normalize(term);

    if (!normalizedTerm) {
      return this.listWorkCenters();
    }

    return this.api.get<ReadonlyArray<WorkCenter>>('/api/work-centers', {
      term: normalizedTerm,
      active: true,
    }).pipe(map(centers => this.cloneCenters(centers)));
  }

  searchActiveWorkCenters(areaCode: string, term: string): Observable<ReadonlyArray<WorkCenter>> {
    const normalizedAreaCode = this.normalize(areaCode);
    const normalizedTerm = this.normalize(term);

    return this.api.get<ReadonlyArray<WorkCenter>>('/api/work-centers', {
      areaCode: normalizedAreaCode,
      term: normalizedTerm || undefined,
      active: true,
    }).pipe(map(centers => this.cloneCenters(centers)));
  }

  findWorkCenter(code: string): Observable<WorkCenter | null> {
    const normalizedCode = this.normalize(code);
    return this.api.get<ReadonlyArray<WorkCenter>>('/api/work-centers', {
      term: normalizedCode,
      active: true,
    }).pipe(map(centers => centers.find(center => this.normalize(center.code) === normalizedCode) ?? null));
  }

  selectWorkCenter(code: string): Observable<WorkCenter | null> {
    const normalizedCode = this.normalize(code);
    return this.findWorkCenter(normalizedCode).pipe(map(selected => {
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

  private cloneCenters(centers: ReadonlyArray<WorkCenter>): ReadonlyArray<WorkCenter> {
    return centers.map(center => ({ ...center }));
  }
}
