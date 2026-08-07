import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, delay, map, of, throwError } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import {
  AtualizarEquipeRequest,
  CriarEquipeRequest,
  EquipeResponseDTO,
  SalvarEquipeRequestDTO,
} from '../interfaces/equipe.dto';
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
  { codigo: 'OP-001', nome: 'Ana Silva' },
]);

interface EquipeCatalogRecord {
  readonly equipe: EquipeResponseDTO;
  readonly areaCode: string;
  readonly workCenterCode: string;
}

const EQUIPES_MOCK: ReadonlyArray<EquipeCatalogRecord> = Object.freeze([
  {
    equipe: {
      codigo: 'MONT03',
      descricao: 'Montagem Zap',
      turno: 'Turno 3',
      operadores: [OPERADORES_MOCK[0], OPERADORES_MOCK[1], OPERADORES_MOCK[3]],
    },
    areaCode: '4001',
    workCenterCode: 'CT-EXT-01',
  },
  {
    equipe: {
      codigo: 'CORTE01',
      descricao: 'Corte Industrial',
      turno: 'Turno 1',
      operadores: [OPERADORES_MOCK[2], OPERADORES_MOCK[4], OPERADORES_MOCK[6]],
    },
    areaCode: '4001',
    workCenterCode: 'CT-EXT-01',
  },
  {
    equipe: {
      codigo: 'EMB02',
      descricao: 'Embalagem',
      turno: 'Turno 2',
      operadores: [],
    },
    areaCode: '4002',
    workCenterCode: 'CT-CQ-01',
  },
]);

@Injectable({ providedIn: 'root' })
export class EquipesService {
  private readonly authSession = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private equipes = this.createInitialCatalog();
  private sessionGeneration = 0;
  private sessionAuthenticated = false;

  constructor() {
    this.authSession.session$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((session) => {
      this.sessionGeneration += 1;
      this.sessionAuthenticated = session !== null;
      this.equipes = this.createInitialCatalog();
    });
  }

  consultarEquipe(codigoEquipe: string): Observable<Equipe> {
    const codigo = this.normalizeCode(codigoEquipe);
    return this.runInActiveSession(() => {
      const record = this.equipes.get(codigo);
      if (!record) {
        throw new Error('Não foi possível localizar a equipe.');
      }
      return this.mapEquipeResponse(record.equipe);
    });
  }

  listarOperadores(): Observable<ReadonlyArray<Operador>> {
    return this.runInActiveSession(() =>
      OPERADORES_MOCK.map((operador) => this.mapOperador(operador)),
    );
  }

  salvarEquipe(request: SalvarEquipeRequestDTO): Observable<void> {
    const codigo = this.normalizeCode(request.codigoEquipe);
    return this.runInActiveSession(() => {
      const record = this.equipes.get(codigo);
      if (!record) {
        throw new Error('Não foi possível salvar as alterações.');
      }

      const codigosUnicos = [
        ...new Set(request.operadores.map((operador) => this.normalizeCode(operador))),
      ];
      const operadores = OPERADORES_MOCK.filter((operador) =>
        codigosUnicos.includes(this.normalizeCode(operador.codigo)),
      );

      this.equipes.set(codigo, {
        ...record,
        equipe: {
          ...record.equipe,
          operadores: operadores.map((operador) => ({ ...operador })),
        },
      });
    });
  }

  listarEquipesElegiveis(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<Equipe>> {
    const area = this.normalizeCode(areaCode);
    const workCenter = this.normalizeCode(workCenterCode);

    if (!area || !workCenter) {
      return this.runInActiveSession(() => []);
    }

    return this.runInActiveSession(() =>
      [...this.equipes.values()]
        .filter((record) => record.areaCode === area && record.workCenterCode === workCenter)
        .map((record) => this.mapEquipeResponse(record.equipe))
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
    );
  }

  criarEquipe(request: CriarEquipeRequest): Observable<Equipe> {
    return this.runInActiveSession(() => {
      const areaCode = this.normalizeCode(request.areaCode);
      const workCenterCode = this.normalizeCode(request.workCenterCode);
      const codigo = this.normalizeCode(request.codigo);
      const descricao = request.descricao.trim();
      const turno = request.turno.trim();

      this.assertContext(areaCode, workCenterCode);
      if (!codigo || !descricao || !turno) {
        throw new Error('Informe código, descrição e turno da equipe.');
      }
      if (this.equipes.has(codigo)) {
        throw new Error('Já existe uma equipe com esse código.');
      }

      const operadores = this.resolveStrictOperators(request.operadores);
      const record: EquipeCatalogRecord = {
        equipe: { codigo, descricao, turno, operadores },
        areaCode,
        workCenterCode,
      };

      this.equipes.set(codigo, this.cloneRecord(record));
      return this.mapEquipeResponse(record.equipe);
    });
  }

  atualizarEquipe(request: AtualizarEquipeRequest): Observable<Equipe> {
    return this.runInActiveSession(() => {
      const areaCode = this.normalizeCode(request.areaCode);
      const workCenterCode = this.normalizeCode(request.workCenterCode);
      const codigo = this.normalizeCode(request.codigo);

      this.assertContext(areaCode, workCenterCode);
      const current = this.equipes.get(codigo);
      if (!current) {
        throw new Error('Não foi possível localizar a equipe.');
      }
      if (current.areaCode !== areaCode || current.workCenterCode !== workCenterCode) {
        throw new Error('A equipe não é elegível para a Área e o Centro de Trabalho informados.');
      }

      const operadores = this.resolveStrictOperators(request.operadores);
      const updated: EquipeCatalogRecord = {
        ...current,
        equipe: {
          ...current.equipe,
          operadores,
        },
      };

      this.equipes.set(codigo, this.cloneRecord(updated));
      return this.mapEquipeResponse(updated.equipe);
    });
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

    return operadores.filter((operador) =>
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
      operadores: this.removerOperadoresDuplicados(
        response.operadores.map((operador) => this.mapOperador(operador)),
      ),
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

  private createInitialCatalog(): Map<string, EquipeCatalogRecord> {
    return new Map(
      EQUIPES_MOCK.map((record) => [
        this.normalizeCode(record.equipe.codigo),
        this.cloneRecord(record),
      ]),
    );
  }

  private cloneRecord(record: EquipeCatalogRecord): EquipeCatalogRecord {
    return {
      equipe: {
        ...record.equipe,
        operadores: record.equipe.operadores.map((operador) => ({ ...operador })),
      },
      areaCode: this.normalizeCode(record.areaCode),
      workCenterCode: this.normalizeCode(record.workCenterCode),
    };
  }

  private assertContext(areaCode: string, workCenterCode: string): void {
    if (!areaCode || !workCenterCode) {
      throw new Error('Informe a Área de Produção e o Centro de Trabalho.');
    }
  }

  private runInActiveSession<T>(operation: () => T): Observable<T> {
    const generation = this.sessionGeneration;
    if (!this.sessionAuthenticated) {
      return throwError(() => new Error('A sessão autenticada não está mais disponível.')).pipe(
        delay(API_DELAY_MS),
      );
    }

    return of(null).pipe(
      delay(API_DELAY_MS),
      map(() => {
        if (!this.sessionAuthenticated || generation !== this.sessionGeneration) {
          throw new Error('A sessão autenticada não está mais disponível.');
        }
        return operation();
      }),
    );
  }

  private resolveStrictOperators(codes: ReadonlyArray<string>): ReadonlyArray<OperadorDTO> {
    if (codes.length === 0) {
      throw new Error('Selecione ao menos um operador.');
    }

    const normalizedCodes = codes.map((code) => this.normalizeCode(code));
    if (new Set(normalizedCodes).size !== normalizedCodes.length) {
      throw new Error('A lista de operadores contém códigos duplicados.');
    }

    const operatorsByCode = new Map(
      OPERADORES_MOCK.map((operator) => [this.normalizeCode(operator.codigo), operator]),
    );
    const operators = normalizedCodes.map((code) => {
      const operator = operatorsByCode.get(code);
      if (!operator) {
        throw new Error(`O operador ${code || '(vazio)'} não existe.`);
      }
      return { ...operator };
    });

    return operators.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }
}
