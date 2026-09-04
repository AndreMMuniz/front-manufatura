import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import {
  AtualizarEquipeRequest,
  CriarEquipeRequest,
  EquipeResponseDTO,
  SalvarEquipeRequestDTO,
} from '../interfaces/equipe.dto';
import { Equipe } from '../models/equipe.model';
import { Operador } from '../models/operador.model';

interface OperatorApiResponse {
  readonly code: string;
  readonly name: string;
}

@Injectable({ providedIn: 'root' })
export class EquipesService {
  constructor(private readonly api: AuthenticatedApiService) {}

  consultarEquipe(codigoEquipe: string): Observable<Equipe> {
    const codigo = this.normalizeCode(codigoEquipe);
    return this.api.get<EquipeResponseDTO>(`/api/teams/${encodeURIComponent(codigo)}`).pipe(
      map(response => this.mapEquipeResponse(response)),
    );
  }

  listarOperadores(): Observable<ReadonlyArray<Operador>> {
    return this.api.get<ReadonlyArray<OperatorApiResponse>>('/api/operators', { active: true }).pipe(
      map(operators => operators.map(operator => ({
        codigo: operator.code,
        nome: operator.name,
      }))),
    );
  }

  salvarEquipe(request: SalvarEquipeRequestDTO): Observable<void> {
    const codigo = this.normalizeCode(request.codigoEquipe);
    return this.api.put<EquipeResponseDTO>(
      `/api/teams/${encodeURIComponent(codigo)}`,
      { operadores: this.uniqueCodes(request.operadores) },
    ).pipe(map(() => undefined));
  }

  listarEquipesElegiveis(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<Equipe>> {
    const area = this.normalizeCode(areaCode);
    const workCenter = this.normalizeCode(workCenterCode);
    return this.api.get<ReadonlyArray<EquipeResponseDTO>>('/api/teams', {
      areaCode: area,
      workCenterCode: workCenter,
    }).pipe(map(responses => responses.map(response => this.mapEquipeResponse(response))));
  }

  criarEquipe(request: CriarEquipeRequest): Observable<Equipe> {
    return this.api.post<EquipeResponseDTO>('/api/teams', {
      areaCode: this.normalizeCode(request.areaCode),
      workCenterCode: this.normalizeCode(request.workCenterCode),
      operadores: this.uniqueCodes(request.operadores),
    }).pipe(map(response => this.mapEquipeResponse(response)));
  }

  atualizarEquipe(request: AtualizarEquipeRequest): Observable<Equipe> {
    const codigo = this.normalizeCode(request.codigo);
    return this.api.put<EquipeResponseDTO>(`/api/teams/${encodeURIComponent(codigo)}`, {
      areaCode: this.normalizeCode(request.areaCode),
      workCenterCode: this.normalizeCode(request.workCenterCode),
      operadores: this.uniqueCodes(request.operadores),
    }).pipe(map(response => this.mapEquipeResponse(response)));
  }

  montarEquipeAtualizada(equipe: Equipe, operadores: ReadonlyArray<Operador>): Equipe {
    return { ...equipe, operadores: this.removerOperadoresDuplicados(operadores) };
  }

  filtrarOperadores(operadores: ReadonlyArray<Operador>, termo: string): ReadonlyArray<Operador> {
    const termoNormalizado = this.normalizeText(termo);
    if (!termoNormalizado) return operadores;
    return operadores.filter(operador =>
      this.normalizeText(`${operador.codigo} ${operador.nome}`).includes(termoNormalizado));
  }

  removerOperadoresDuplicados(operadores: ReadonlyArray<Operador>): ReadonlyArray<Operador> {
    const byCode = new Map<string, Operador>();
    for (const operador of operadores) byCode.set(this.normalizeCode(operador.codigo), operador);
    return [...byCode.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  private mapEquipeResponse(response: EquipeResponseDTO): Equipe {
    return {
      codigo: response.codigo,
      descricao: response.descricao,
      turno: response.turno,
      operadores: this.removerOperadoresDuplicados(
        response.operadores.map(operator => ({ codigo: operator.codigo, nome: operator.nome })),
      ),
    };
  }

  private uniqueCodes(codes: ReadonlyArray<string>): ReadonlyArray<string> {
    return [...new Set(codes.map(code => this.normalizeCode(code)).filter(Boolean))];
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizeText(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
}
