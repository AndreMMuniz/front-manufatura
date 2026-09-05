import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Optional } from '@angular/core';
import { Observable, catchError, from, map, throwError } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { normalizeCommandError } from '../../../core/offline/models/sync-error';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
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

export interface AtualizarEquipeResultado {
  readonly equipe?: Equipe;
  readonly sincronizacaoPendente: boolean;
}

@Injectable({ providedIn: 'root' })
export class EquipesService {
  constructor(
    private readonly api: AuthenticatedApiService,
    @Optional()
    private readonly commands: OperationalCommandFacade | null = null,
  ) {}

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

  atualizarEquipe(request: AtualizarEquipeRequest): Observable<AtualizarEquipeResultado> {
    const codigo = this.normalizeCode(request.codigo);
    const operadores = this.uniqueCodes(request.operadores);
    return this.api.put<EquipeResponseDTO>(`/api/teams/${encodeURIComponent(codigo)}`, {
      operadores,
    }).pipe(
      map(response => ({
        equipe: this.mapEquipeResponse(response),
        sincronizacaoPendente: false,
      })),
      catchError((error: unknown) => {
        const normalized = normalizeCommandError(this.publicCommandError(error));
        if (normalized.category !== 'TRANSIENT' || !this.commands) {
          return throwError(() => new Error(normalized.userMessage));
        }
        return from(this.commands.capture({
          commandType: 'UPDATE_TEAM',
          aggregateId: codigo,
          businessStatus: 'ALTERACAO_PENDENTE',
          payload: { codigo, operadores: [...operadores] },
        })).pipe(map(() => ({ sincronizacaoPendente: true })));
      }),
    );
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
    const alertas = response.alertas?.map(alerta => ({ mensagem: alerta.mensagem })) ?? [];
    return {
      codigo: response.codigo,
      descricao: response.descricao,
      turno: response.turno,
      operadores: this.removerOperadoresDuplicados(
        response.operadores.map(operator => ({ codigo: operator.codigo, nome: operator.nome })),
      ),
      ...(alertas.length > 0 ? { alertas } : {}),
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

  private publicCommandError(error: unknown): unknown {
    if (!(error instanceof HttpErrorResponse)) return error;
    const body = error.error;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? { status: error.status, ...(body as Readonly<Record<string, unknown>>) }
      : { status: error.status };
  }
}
