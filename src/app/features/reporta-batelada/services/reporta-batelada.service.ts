import { Injectable, inject } from '@angular/core';

import { Observable, delay, map, of } from 'rxjs';

import { ReportOperacaoService } from '../../report-operacao/services/report-operacao.service';
import { WorkCenter } from '../../shop-floor/models/work-center';
import {
  IniciarBateladaRequest,
  IniciarBateladaResponse,
} from '../interfaces/reporta-batelada.dto';
import {
  AreaProducaoBatelada,
  ContextoBatelada,
  InicioBatelada,
  OrdemLiberadaBatelada,
  ResponsavelBatelada,
} from '../models/reporta-batelada.model';

@Injectable({ providedIn: 'root' })
export class ReportaBateladaService {
  private readonly catalog = inject(ReportOperacaoService);

  listarAreas(): Observable<ReadonlyArray<AreaProducaoBatelada>> {
    return this.catalog.listarAreasProducao().pipe(
      map(areas => areas.map(area => ({ code: area.code, description: area.description }))),
    );
  }

  pesquisarCentros(areaCode: string, termo: string): Observable<ReadonlyArray<WorkCenter>> {
    if (!areaCode.trim()) {
      return of([]);
    }

    return this.catalog.pesquisarCentrosTrabalho(areaCode, termo).pipe(
      map(centers => centers.map(center => ({ ...center }))),
    );
  }

  listarOrdensLiberadas(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<OrdemLiberadaBatelada>> {
    if (!areaCode.trim() || !workCenterCode.trim()) {
      return of([]);
    }

    return this.catalog.listarOrdensPorCentro(areaCode, workCenterCode).pipe(
      map(orders => orders.map(order => ({ ...order }))),
    );
  }

  listarResponsaveisElegiveis(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<ResponsavelBatelada>> {
    if (!areaCode.trim() || !workCenterCode.trim()) {
      return of([]);
    }

    return this.catalog.listarResponsaveis(areaCode, workCenterCode).pipe(
      map(responsaveis => responsaveis.map(responsavel => ({ ...responsavel }))),
    );
  }

  montarComandoInicio(
    contexto: ContextoBatelada,
    responsavel: ResponsavelBatelada,
    ordens: ReadonlyArray<OrdemLiberadaBatelada>,
  ): IniciarBateladaRequest {
    return {
      contexto: { ...contexto },
      responsavel: { ...responsavel },
      ordens: ordens.map(ordem => ({ ...ordem })),
    };
  }

  iniciarBatelada(request: IniciarBateladaRequest): Observable<InicioBatelada> {
    const response: IniciarBateladaResponse = {
      status: 'SUCESSO_INTEGRAL',
      iniciadoEm: new Date(),
      resultados: request.ordens.map(ordem => ({ ordemId: ordem.id, sucesso: true })),
    };

    return of(response).pipe(
      delay(200),
      map(result => this.validarRespostaInicio(result, request.ordens.map(ordem => ordem.id))),
    );
  }

  validarRespostaInicio(
    response: IniciarBateladaResponse,
    expectedOrderIds: ReadonlyArray<string>,
  ): InicioBatelada {
    const expected = new Set(expectedOrderIds);
    const received = new Set(response.resultados.map(result => result.ordemId));
    const complete =
      response.status === 'SUCESSO_INTEGRAL' &&
      response.iniciadoEm instanceof Date &&
      response.resultados.length === expected.size &&
      response.resultados.every(result => result.sucesso && expected.has(result.ordemId)) &&
      [...expected].every(id => received.has(id));

    if (!complete) {
      throw new Error('O início conjunto não foi confirmado para todas as ordens.');
    }

    return {
      iniciadoEm: new Date(response.iniciadoEm),
      ordensIniciadas: expectedOrderIds.map(id => id),
    };
  }

}
