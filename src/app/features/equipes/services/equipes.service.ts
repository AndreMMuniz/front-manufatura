import { Injectable } from '@angular/core';
import { Observable, delay, map, of, throwError } from 'rxjs';

import { EquipeResponseDTO, SalvarEquipeRequestDTO } from '../interfaces/equipe.dto';
import { OperadorDTO } from '../interfaces/operador.dto';
import { Equipe } from '../models/equipe.model';
import { Operador } from '../models/operador.model';

const API_DELAY_MS = 250;

const OPERADORES_MOCK: ReadonlyArray<OperadorDTO> = Object.freeze([
  { codigo: '001', nome: 'Jose Ribeiro Neto' },
  { codigo: '002', nome: 'Almir Rogerio Bento' },
  { codigo: '003', nome: 'Carlos Silva' },
  { codigo: '004', nome: 'Marcelo Costa' },
  { codigo: '005', nome: 'Fernanda Alves' },
  { codigo: '006', nome: 'Roberto Souza' },
  { codigo: '007', nome: 'Ana Paula Lima' },
  { codigo: '008', nome: 'Diego Martins' },
  { codigo: '009', nome: 'Juliana Pereira' },
  { codigo: '010', nome: 'Rafael Gomes' },
]);

const EQUIPES_MOCK: ReadonlyArray<EquipeResponseDTO> = Object.freeze([
  {
    codigo: 'MONT03',
    descricao: 'Montagem Zap',
    turno: 'Turno 3',
    operadores: [OPERADORES_MOCK[0], OPERADORES_MOCK[1], OPERADORES_MOCK[3]],
  },
  {
    codigo: 'CORTE01',
    descricao: 'Corte Industrial',
    turno: 'Turno 1',
    operadores: [OPERADORES_MOCK[2], OPERADORES_MOCK[4], OPERADORES_MOCK[6]],
  },
  {
    codigo: 'EMB02',
    descricao: 'Embalagem',
    turno: 'Turno 2',
    operadores: [],
  },
]);

@Injectable({ providedIn: 'root' })
export class EquipesService {
  private equipes = new Map(EQUIPES_MOCK.map(equipe => [this.normalizeCode(equipe.codigo), equipe]));

  consultarEquipe(codigoEquipe: string): Observable<Equipe> {
    const codigo = this.normalizeCode(codigoEquipe);
    const equipe = this.equipes.get(codigo);

    if (!equipe) {
      return throwError(() => new Error('Não foi possível localizar a equipe.')).pipe(delay(API_DELAY_MS));
    }

    return of(equipe).pipe(
      delay(API_DELAY_MS),
      map(response => this.mapEquipeResponse(response)),
    );
  }

  listarOperadores(): Observable<ReadonlyArray<Operador>> {
    return of(OPERADORES_MOCK).pipe(
      delay(API_DELAY_MS),
      map(operadores => operadores.map(operador => this.mapOperador(operador))),
    );
  }

  salvarEquipe(request: SalvarEquipeRequestDTO): Observable<void> {
    const codigo = this.normalizeCode(request.codigoEquipe);
    const equipe = this.equipes.get(codigo);

    if (!equipe) {
      return throwError(() => new Error('Não foi possível salvar as alterações.')).pipe(delay(API_DELAY_MS));
    }

    const codigosUnicos = [...new Set(request.operadores.map(operador => this.normalizeCode(operador)))];
    const operadores = OPERADORES_MOCK.filter(operador => codigosUnicos.includes(this.normalizeCode(operador.codigo)));

    this.equipes.set(codigo, {
      ...equipe,
      operadores,
    });

    return of(undefined).pipe(delay(API_DELAY_MS));
  }

  montarEquipeAtualizada(equipe: Equipe, operadores: ReadonlyArray<Operador>): Equipe {
    return {
      ...equipe,
      operadores: this.removerOperadoresDuplicados(operadores),
    };
  }

  filtrarOperadores(operadores: ReadonlyArray<Operador>, termo: string): ReadonlyArray<Operador> {
    const termoNormalizado = this.normalizeText(termo);

    if (!termoNormalizado) {
      return operadores;
    }

    return operadores.filter(operador =>
      this.normalizeText(`${operador.codigo} ${operador.nome}`).includes(termoNormalizado),
    );
  }

  removerOperadoresDuplicados(operadores: ReadonlyArray<Operador>): ReadonlyArray<Operador> {
    const operadoresPorCodigo = new Map<string, Operador>();

    for (const operador of operadores) {
      operadoresPorCodigo.set(this.normalizeCode(operador.codigo), operador);
    }

    return [...operadoresPorCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  private mapEquipeResponse(response: EquipeResponseDTO): Equipe {
    return {
      codigo: response.codigo,
      descricao: response.descricao,
      turno: response.turno,
      operadores: this.removerOperadoresDuplicados(response.operadores.map(operador => this.mapOperador(operador))),
    };
  }

  private mapOperador(dto: OperadorDTO): Operador {
    return {
      codigo: dto.codigo,
      nome: dto.nome,
    };
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
