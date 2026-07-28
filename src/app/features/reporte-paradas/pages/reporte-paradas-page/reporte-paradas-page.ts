import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { forkJoin, timer } from 'rxjs';

import {
  PoButtonModule,
  PoDialogService,
  PoLoadingModule,
  PoNotificationService,
  PoPageModule,
} from '@po-ui/ng-components';

import { ContextoProducaoSelector } from '../../../shop-floor/components/contexto-producao-selector/contexto-producao-selector';
import { AreaProducao } from '../../../shop-floor/models/production-area';
import { WorkCenter } from '../../../shop-floor/models/work-center';
import { ParadaForm } from '../../components/parada-form/parada-form';
import { FinalizarParadaForm } from '../../components/finalizar-parada-form/finalizar-parada-form';
import { ParadasEmAndamentoList } from '../../components/paradas-em-andamento-list/paradas-em-andamento-list';
import { ResponsavelParadaSelect } from '../../components/responsavel-parada-select/responsavel-parada-select';
import {
  ProductionContext,
  ResponsavelParada,
  TipoResponsavelParada,
} from '../../models/reporte-paradas.model';
import {
  ParadaDraft,
  FinalizacaoDraft,
  ReporteParadasWorkflowSnapshot,
  ReporteParadasWorkflowState,
} from '../../services/reporte-paradas-workflow-state';
import { ReporteParadasService } from '../../services/reporte-paradas.service';

@Component({
  selector: 'app-reporte-paradas-page',
  imports: [
    ContextoProducaoSelector,
    ParadaForm,
    FinalizarParadaForm,
    ParadasEmAndamentoList,
    ResponsavelParadaSelect,
    PoButtonModule,
    PoLoadingModule,
    PoPageModule,
  ],
  providers: [ReporteParadasWorkflowState],
  templateUrl: './reporte-paradas-page.html',
  styleUrls: ['./reporte-paradas-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteParadasPage implements OnInit {
  private readonly service = inject(ReporteParadasService);
  private readonly workflow = inject(ReporteParadasWorkflowState);
  private readonly notification = inject(PoNotificationService);
  private readonly dialog = inject(PoDialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly view = signal<ReporteParadasWorkflowSnapshot>(this.workflow.snapshot());
  readonly areas = signal<ReadonlyArray<AreaProducao>>([]);
  readonly centers = signal<ReadonlyArray<WorkCenter>>([]);
  readonly loadingAreas = signal(false);
  readonly loadingCenters = signal(false);
  readonly pageError = signal('');
  readonly registrationError = signal('');
  readonly statusMessage = signal('');
  readonly now = signal(new Date());

  @ViewChild(FinalizarParadaForm) private finishForm?: FinalizarParadaForm;
  @ViewChild(ParadasEmAndamentoList) private openStopsList?: ParadasEmAndamentoList;

  private areasRequest = 0;
  private centersRequest = 0;
  private idempotencySequence = 0;
  private finishIdempotencySequence = 0;

  ngOnInit(): void {
    const prefill = this.service.getPrefillContext();
    this.service.clearPrefillContext();
    this.loadAreas(prefill);
    this.now.set(new Date());
    timer(30_000, 30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(new Date()));
    this.destroyRef.onDestroy(() => this.workflow.resetTransient());
  }

  onAreaChange(code: string): void {
    if (this.commandsBlocked() || code === (this.view().area?.code ?? '')) {
      return;
    }
    const area = this.areas().find(item => this.sameCode(item.code, code)) ?? null;
    this.confirmDiscardIfNeeded(() => this.applyArea(area));
  }

  onWorkCenterChange(code: string): void {
    if (this.commandsBlocked() || code === (this.view().workCenter?.code ?? '')) {
      return;
    }
    const center = this.centers().find(item =>
      item.active
      && this.sameCode(item.code, code)
      && this.sameCode(item.areaCode, this.view().area?.code ?? ''),
    ) ?? null;
    this.confirmDiscardIfNeeded(() => this.applyWorkCenter(center));
  }

  onResponsibleTypeChange(type: TipoResponsavelParada): void {
    if (this.view().saving) {
      return;
    }
    this.workflow.setResponsibleType(type);
    this.syncView();
  }

  onResponsibleCodeChange(code: string): void {
    if (this.view().saving) {
      return;
    }
    this.workflow.setResponsibleCode(code);
    this.syncView();
  }

  onDraftChange(draft: ParadaDraft): void {
    if (this.view().saving) {
      return;
    }
    this.workflow.updateDraft(draft);
    this.registrationError.set('');
    this.syncView();
  }

  onFinishDraftChange(draft: FinalizacaoDraft): void {
    if (this.view().finishing) {
      return;
    }
    this.workflow.updateFinishDraft(draft);
    this.syncView();
  }

  retryContext(): void {
    const snapshot = this.view();
    if (!snapshot.saving && snapshot.area && snapshot.workCenter) {
      this.loadContextData(snapshot.area.code, snapshot.workCenter.code);
    }
  }

  retryAreas(): void {
    if (!this.view().saving && !this.loadingAreas()) {
      this.loadAreas(null);
    }
  }

  retryOpenStops(): void {
    const snapshot = this.view();
    if (!this.commandsBlocked() && snapshot.area && snapshot.workCenter) {
      this.loadOpenStops(snapshot.area.code, snapshot.workCenter.code);
    }
  }

  selecionarParada(stopId: number): void {
    if (this.commandsBlocked() || !this.workflow.selectOpenStop(stopId, new Date())) {
      return;
    }
    this.syncView();
    Promise.resolve().then(() => this.finishForm?.focusFirstField());
  }

  finalizarParada(): void {
    const snapshot = this.view();
    if (snapshot.finishing || snapshot.saving
      || !snapshot.area || !snapshot.workCenter || snapshot.selectedStopId === null
      || !snapshot.finishDraft.endDate || !snapshot.finishDraft.endTime.trim()) {
      return;
    }
    const key = this.workflow.ensureFinishIdempotencyKey(
      () => `finish-stop-${Date.now()}-${++this.finishIdempotencySequence}`,
    );
    const token = this.workflow.beginFinishCommand(
      snapshot.selectedStopId,
      snapshot.area.code,
      snapshot.workCenter.code,
    );
    this.statusMessage.set('');
    this.syncView();

    this.service.finalizarParada(snapshot.selectedStopId, {
      endDate: snapshot.finishDraft.endDate,
      endTime: snapshot.finishDraft.endTime,
      idempotencyKey: key,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: stop => {
          if (!this.workflow.acceptFinishSuccess(token, stop.id)) {
            return;
          }
          this.syncView();
          this.statusMessage.set(
            'Finalização salva neste dispositivo e pendente de sincronização.',
          );
          this.notification.success(
            'Finalização salva neste dispositivo e pendente de sincronização.',
          );
          const route = this.view().origin?.sourceRoute;
          if (route === '/operation-reporting' || route === '/batch-reporting') {
            void this.router.navigate([route]);
          } else {
            Promise.resolve().then(() => this.openStopsList?.focusFirst());
          }
        },
        error: () => {
          if (this.workflow.acceptFinishError(
            token,
            'Não foi possível finalizar a parada. Os dados informados foram preservados.',
          )) {
            this.syncView();
          }
        },
      });
  }

  registrarParada(): void {
    const snapshot = this.view();
    if (snapshot.saving) {
      return;
    }
    if (!snapshot.area || !snapshot.workCenter) {
      this.notification.warning('Informe a Área de Produção e o Centro de Trabalho.');
      return;
    }
    const responsible = this.findSelectedResponsible(snapshot);
    if (!responsible) {
      this.notification.warning('Selecione um responsável elegível para a Área e o Centro de Trabalho.');
      return;
    }
    if (snapshot.draft.reasonId === null
      || !snapshot.draft.startDate
      || !snapshot.draft.startTime.trim()) {
      this.notification.warning('Informe motivo, Data Inicial e Hora Inicial.');
      return;
    }

    const idempotencyKey = this.workflow.ensureIdempotencyKey(
      () => `stop-${Date.now()}-${++this.idempotencySequence}`,
    );
    this.workflow.setSaving(true);
    this.registrationError.set('');
    this.statusMessage.set('');
    this.syncView();

    this.service.registrarParada({
      areaCode: snapshot.area.code,
      workCenterCode: snapshot.workCenter.code,
      reasonId: snapshot.draft.reasonId,
      responsible,
      startDate: snapshot.draft.startDate,
      startTime: snapshot.draft.startTime,
      endDate: snapshot.draft.endDate,
      endTime: snapshot.draft.endTime,
      programmed: snapshot.draft.programmed,
      origin: snapshot.origin,
      idempotencyKey,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: stop => {
          this.workflow.completeRegistration();
          this.syncView();
          this.statusMessage.set(
            `Parada ${stop.status === 'EM_ANDAMENTO' ? 'em andamento' : 'finalizada'} salva neste dispositivo e pendente de sincronização.`,
          );
          this.notification.success('Parada salva neste dispositivo e pendente de sincronização.');
          if (stop.status === 'EM_ANDAMENTO' && snapshot.area && snapshot.workCenter) {
            this.loadOpenStops(snapshot.area.code, snapshot.workCenter.code);
          }
        },
        error: (error: unknown) => {
          this.workflow.setSaving(false);
          this.syncView();
          const message = error instanceof Error
            ? error.message
            : 'Não foi possível registrar a parada. O rascunho foi preservado.';
          this.registrationError.set(message);
          this.notification.error(message);
        },
      });
  }

  voltar(): void {
    if (this.commandsBlocked()) {
      return;
    }
    const route = this.view().origin?.sourceRoute;
    void this.router.navigate([
      route === '/operation-reporting' || route === '/batch-reporting' ? route : '/menu',
    ]);
  }

  private loadAreas(prefill: ProductionContext | null): void {
    const request = ++this.areasRequest;
    this.loadingAreas.set(true);
    this.pageError.set('');
    this.service.listarAreas()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: areas => {
          if (request !== this.areasRequest) {
            return;
          }
          this.areas.set(areas.map(area => ({ ...area })));
          this.loadingAreas.set(false);
          if (prefill) {
            this.loadPrefill(prefill, request);
          }
        },
        error: () => {
          if (request !== this.areasRequest) {
            return;
          }
          this.loadingAreas.set(false);
          this.pageError.set('Não foi possível carregar as Áreas de Produção.');
        },
      });
  }

  private loadPrefill(prefill: ProductionContext, areasRequest: number): void {
    const area = this.areas().find(item => this.sameCode(item.code, prefill.area.code));
    if (!area || !prefill.workCenter.active
      || !this.sameCode(prefill.workCenter.areaCode, area.code)) {
      return;
    }
    const request = ++this.centersRequest;
    this.loadingCenters.set(true);
    this.service.pesquisarCentros(area.code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: centers => {
          if (areasRequest !== this.areasRequest || request !== this.centersRequest) {
            return;
          }
          this.loadingCenters.set(false);
          this.centers.set(centers.map(center => ({ ...center })));
          const center = centers.find(item =>
            item.active
            && this.sameCode(item.code, prefill.workCenter.code)
            && this.sameCode(item.areaCode, area.code),
          );
          if (!center) {
            return;
          }
          forkJoin({
            responsibles: this.service.listarResponsaveis(area.code, center.code),
            reasons: this.service.listarMotivos(area.code, center.code),
          })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: ({ responsibles, reasons }) => {
                if (areasRequest !== this.areasRequest || request !== this.centersRequest) {
                  return;
                }
                if (!this.workflow.applyPrefill(prefill, this.areas(), centers, responsibles)) {
                  return;
                }
                const token = this.workflow.beginContextRequest(area.code, center.code);
                this.workflow.acceptContextData(token, responsibles, reasons);
                this.syncView();
                this.loadOpenStops(area.code, center.code);
              },
              error: () => {
                if (areasRequest === this.areasRequest && request === this.centersRequest) {
                  this.pageError.set('Não foi possível revalidar o contexto recebido.');
                }
              },
            });
        },
        error: () => {
          if (areasRequest === this.areasRequest && request === this.centersRequest) {
            this.loadingCenters.set(false);
            this.pageError.set('Não foi possível revalidar o Centro de Trabalho recebido.');
          }
        },
      });
  }

  private applyArea(area: AreaProducao | null): void {
    this.centersRequest += 1;
    this.centers.set([]);
    this.loadingCenters.set(false);
    this.pageError.set('');
    this.registrationError.set('');
    this.statusMessage.set('');
    this.workflow.confirmAreaChange(area);
    this.syncView();
    if (area) {
      this.loadCenters(area.code);
    }
  }

  private loadCenters(areaCode: string): void {
    const request = ++this.centersRequest;
    this.loadingCenters.set(true);
    this.service.pesquisarCentros(areaCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: centers => {
          if (request !== this.centersRequest
            || !this.sameCode(this.view().area?.code ?? '', areaCode)) {
            return;
          }
          this.centers.set(centers
            .filter(center => center.active && this.sameCode(center.areaCode, areaCode))
            .map(center => ({ ...center })));
          this.loadingCenters.set(false);
        },
        error: () => {
          if (request !== this.centersRequest) {
            return;
          }
          this.loadingCenters.set(false);
          this.pageError.set('Não foi possível carregar os Centros de Trabalho.');
        },
      });
  }

  private applyWorkCenter(center: WorkCenter | null): void {
    this.registrationError.set('');
    this.statusMessage.set('');
    this.workflow.confirmWorkCenterChange(center);
    this.syncView();
    if (center && this.view().area) {
      this.loadContextData(this.view().area!.code, center.code);
    }
  }

  private loadContextData(areaCode: string, workCenterCode: string): void {
    const token = this.workflow.beginContextRequest(areaCode, workCenterCode);
    this.syncView();
    forkJoin({
      responsibles: this.service.listarResponsaveis(areaCode, workCenterCode),
      reasons: this.service.listarMotivos(areaCode, workCenterCode),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ responsibles, reasons }) => {
          if (this.workflow.acceptContextData(token, responsibles, reasons)) {
            this.syncView();
            this.loadOpenStops(areaCode, workCenterCode);
          }
        },
        error: () => {
          if (this.workflow.acceptContextError(
            token,
            'Não foi possível carregar responsáveis e motivos. Tente novamente.',
          )) {
            this.syncView();
          }
        },
      });
  }

  private loadOpenStops(areaCode: string, workCenterCode: string): void {
    const token = this.workflow.beginOpenStopsQuery(areaCode, workCenterCode);
    this.syncView();
    this.service.listarParadasEmAndamento(areaCode, workCenterCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: stops => {
          if (this.workflow.acceptOpenStops(token, stops)) {
            this.syncView();
          }
        },
        error: () => {
          if (this.workflow.acceptOpenStopsError(
            token,
            'Não foi possível consultar as paradas em andamento. Tente novamente.',
          )) {
            this.syncView();
          }
        },
      });
  }

  private confirmDiscardIfNeeded(action: () => void): void {
    if (!this.view().dirty) {
      action();
      return;
    }
    this.dialog.confirm({
      title: 'Descartar rascunho da parada?',
      message: 'A troca do contexto descartará os dados ainda não registrados. Deseja continuar?',
      literals: { cancel: 'Cancelar', confirm: 'Descartar e continuar' },
      confirm: action,
      cancel: () => this.workflow.cancelContextChange(),
    });
  }

  private findSelectedResponsible(
    snapshot: ReporteParadasWorkflowSnapshot,
  ): ResponsavelParada | undefined {
    return snapshot.responsibles.find(item =>
      item.tipo === snapshot.responsibleType
      && this.sameCode(item.codigo, snapshot.responsibleCode),
    );
  }

  private syncView(): void {
    this.view.set(this.workflow.snapshot());
  }

  private sameCode(left: string, right: string): boolean {
    return left.trim().toUpperCase() === right.trim().toUpperCase();
  }

  private commandsBlocked(): boolean {
    return this.view().saving || this.view().finishing;
  }
}
