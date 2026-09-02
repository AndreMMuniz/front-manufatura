import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  ViewChild,
  inject,
  signal,
  effect,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { forkJoin, timer } from 'rxjs';

import {
  PoButtonModule,
  PoDialogService,
  PoNotificationService,
  PoPageModule,
} from '@po-ui/ng-components';

import { ContextoProducaoSelector } from '../../../shop-floor/components/contexto-producao-selector/contexto-producao-selector';
import { AreaProducao } from '../../../shop-floor/models/production-area';
import { WorkCenter } from '../../../shop-floor/models/work-center';
import {
  RecentProductionContext,
  RecentProductionContextService,
} from '../../../shop-floor/services/recent-production-context.service';
import { ParadaForm } from '../../components/parada-form/parada-form';
import { FinalizarParadaForm } from '../../components/finalizar-parada-form/finalizar-parada-form';
import { ParadasEmAndamentoList } from '../../components/paradas-em-andamento-list/paradas-em-andamento-list';
import { ResponsavelParadaSelect } from '../../components/responsavel-parada-select/responsavel-parada-select';
import {
  ProductionContext,
  ResponsavelParada,
  StopId,
  TipoResponsavelParada,
} from '../../models/reporte-paradas.model';
import {
  ParadaDraft,
  FinalizacaoDraft,
  ReporteParadasWorkflowSnapshot,
  ReporteParadasWorkflowState,
} from '../../services/reporte-paradas-workflow-state';
import { ReporteParadasService } from '../../services/reporte-paradas.service';
import { PwaWorkStateService } from '../../../../core/offline/pwa/pwa-work-state.service';
import { IdempotencyService } from '../../../../core/offline/services/idempotency.service';
import { OperationalCorrectionNotice } from '../../../../core/offline/components/operational-correction-notice/operational-correction-notice';

@Component({
  selector: 'app-reporte-paradas-page',
  imports: [
    ContextoProducaoSelector,
    ParadaForm,
    FinalizarParadaForm,
    ParadasEmAndamentoList,
    ResponsavelParadaSelect,
    PoButtonModule,
    PoPageModule,
    OperationalCorrectionNotice,
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
  private readonly pwaWorkState = inject(PwaWorkStateService);
  private readonly idempotency = inject(IdempotencyService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly recentContextService = inject(RecentProductionContextService);

  readonly view = signal<ReporteParadasWorkflowSnapshot>(this.workflow.snapshot());
  readonly areas = signal<ReadonlyArray<AreaProducao>>([]);
  readonly areaCode = signal('');
  readonly recentContexts = signal<ReadonlyArray<RecentProductionContext>>([]);
  readonly centers = signal<ReadonlyArray<WorkCenter>>([]);
  readonly loadingAreas = signal(false);
  readonly loadingCenters = signal(false);
  readonly pageError = signal('');
  readonly registrationError = signal('');
  readonly statusMessage = signal('');
  readonly now = signal(new Date());
  readonly contextFinishing = signal(false);
  readonly deleting = signal(false);

  @ViewChild(FinalizarParadaForm) private finishForm?: FinalizarParadaForm;
  @ViewChild(ParadasEmAndamentoList) private openStopsList?: ParadasEmAndamentoList;

  private areasRequest = 0;
  private centersRequest = 0;
  private pendingPrefill: ProductionContext | null = null;
  private contextFinishIdempotency: { readonly fingerprint: string; readonly key: string } | null =
    null;

  constructor() {
    effect(() => {
      const view = this.view();
      this.pwaWorkState.setCaptureActive(
        'stoppages',
        view.dirty
          || view.finishDirty
          || view.selectedStopId !== null
          || view.saving
          || view.finishing
          || this.contextFinishing(),
      );
    });
    this.destroyRef.onDestroy(() => this.pwaWorkState.setCaptureActive('stoppages', false));
  }

  ngOnInit(): void {
    this.pendingPrefill = this.service.getPrefillContext();
    this.recentContexts.set(this.recentContextService.list());
    if (this.pendingPrefill) {
      this.areaCode.set(this.normalizeCode(this.pendingPrefill.area.code));
      this.areas.set([{ ...this.pendingPrefill.area }]);
      this.loadPrefill(this.pendingPrefill, this.areasRequest);
    }
    this.now.set(new Date());
    timer(30_000, 30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(new Date()));
    this.destroyRef.onDestroy(() => this.workflow.resetTransient());
  }

  onAreaInput(code: string): void {
    if (this.commandsBlocked() || code === (this.view().area?.code ?? '')) {
      return;
    }
    this.confirmDiscardIfNeeded(() => {
      this.areaCode.set(this.normalizeCode(code));
      this.applyArea(null);
    });
  }

  onAreaChange(code: string): void {
    this.onAreaInput(code);
    if (this.areaCode() && this.sameCode(this.areaCode(), code)) {
      this.loadCenters(this.areaCode());
    }
  }

  validateArea(code: string, prefillCode = ''): void {
    const normalized = this.normalizeCode(code);
    if (!normalized) {
      this.onAreaInput('');
      return;
    }
    this.areaCode.set(normalized);
    this.loadCenters(normalized, prefillCode);
  }

  selectRecentContext(context: RecentProductionContext): void {
    this.confirmDiscardIfNeeded(() => {
      this.areaCode.set(context.areaCode);
      this.applyArea(null);
      this.areaCode.set(context.areaCode);
      this.loadCenters(context.areaCode);
    });
  }

  onWorkCenterChange(code: string): void {
    if (this.commandsBlocked() || code === (this.view().workCenter?.code ?? '')) {
      return;
    }
    const center =
      this.centers().find(
        (item) =>
          item.active &&
          this.sameCode(item.code, code) &&
          this.sameCode(item.areaCode, this.view().area?.code ?? ''),
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
    if (!this.view().saving && !this.loadingCenters()) {
      if (this.pendingPrefill) {
        this.loadPrefill(this.pendingPrefill, this.areasRequest);
      } else {
        this.validateArea(this.areaCode(), this.view().workCenter?.code ?? '');
      }
    }
  }

  retryOpenStops(): void {
    const snapshot = this.view();
    if (!this.commandsBlocked() && snapshot.area && snapshot.workCenter) {
      this.loadOpenStops(snapshot.area.code, snapshot.workCenter.code);
    }
  }

  selecionarParada(stopId: StopId): void {
    if (this.commandsBlocked() || !this.workflow.selectOpenStop(stopId, new Date())) {
      return;
    }
    this.syncView();
    this.changeDetector.detectChanges();
    this.finishForm?.focusFirstField();
  }

  finalizarParada(): void {
    const snapshot = this.view();
    if (
      snapshot.finishing ||
      snapshot.saving ||
      !snapshot.area ||
      !snapshot.workCenter ||
      snapshot.selectedStopId === null ||
      !snapshot.finishDraft.endDate ||
      !snapshot.finishDraft.endTime.trim()
    ) {
      return;
    }
    const key = this.workflow.ensureFinishIdempotencyKey(() => this.idempotency.resolve());
    const token = this.workflow.beginFinishCommand(
      snapshot.selectedStopId,
      snapshot.area.code,
      snapshot.workCenter.code,
    );
    this.statusMessage.set('');
    this.syncView();

    this.service
      .finalizarParada(snapshot.selectedStopId, {
        endDate: snapshot.finishDraft.endDate,
        endTime: snapshot.finishDraft.endTime,
        idempotencyKey: key,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stop) => {
          if (stop.delivery.status === 'ERROR') {
            const message = stop.delivery.error.userMessage;
            if (this.workflow.acceptFinishError(token, message)) {
              this.syncView();
              this.notification.error(message);
            }
            return;
          }
          if (!this.workflow.acceptFinishSuccess(token, stop.id)) {
            return;
          }
          this.syncView();
          if (stop.delivery.status === 'SYNCED') {
            this.statusMessage.set('Finalização enviada ao Datasul.');
            this.notification.success('Finalização enviada ao Datasul.');
          } else {
            this.statusMessage.set(
              'Datasul indisponível — finalização salva neste dispositivo e pendente de sincronização.',
            );
            this.notification.warning(
              'Datasul indisponível — finalização salva neste dispositivo e pendente de sincronização.',
            );
          }
          const route = this.view().origin?.sourceRoute;
          if (route === '/operation-reporting' || route === '/batch-reporting') {
            void this.router.navigate([route]);
          } else {
            Promise.resolve().then(() => this.openStopsList?.focusFirst());
          }
        },
        error: () => {
          if (
            this.workflow.acceptFinishError(
              token,
              'Não foi possível finalizar a parada. Os dados informados foram preservados.',
            )
          ) {
            this.syncView();
          }
        },
      });
  }

  solicitarEliminacao(): void {
    const snapshot = this.view();
    if (this.commandsBlocked() || snapshot.selectedStopId === null) return;
    this.dialog.confirm({
      title: 'Eliminar parada?',
      message: 'Eliminar a parada selecionada? Esta ação não poderá ser desfeita.',
      literals: { cancel: 'Cancelar', confirm: 'Eliminar parada' },
      confirm: () => this.eliminarParadaSelecionada(),
    });
  }

  private eliminarParadaSelecionada(): void {
    const snapshot = this.view();
    if (
      this.commandsBlocked() ||
      !snapshot.area ||
      !snapshot.workCenter ||
      snapshot.selectedStopId === null
    ) {
      return;
    }
    const key = this.workflow.ensureFinishIdempotencyKey(() => this.idempotency.resolve());
    const token = this.workflow.beginFinishCommand(
      snapshot.selectedStopId,
      snapshot.area.code,
      snapshot.workCenter.code,
    );
    this.deleting.set(true);
    this.statusMessage.set('');
    this.syncView();

    this.service.eliminarParada(snapshot.selectedStopId, { idempotencyKey: key })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.deleting.set(false);
          if (result.delivery.status === 'ERROR') {
            const message = result.delivery.error.userMessage;
            if (this.workflow.acceptFinishError(token, message)) {
              this.syncView();
              this.notification.error(message);
            }
            return;
          }
          if (!this.workflow.acceptFinishSuccess(token, result.id)) return;
          this.syncView();
          if (result.delivery.status === 'SYNCED') {
            this.statusMessage.set('Parada eliminada no Datasul.');
            this.notification.success('Parada eliminada no Datasul.');
          } else {
            const message =
              'Datasul indisponível — eliminação salva neste dispositivo e pendente de sincronização.';
            this.statusMessage.set(message);
            this.notification.warning(message);
          }
          Promise.resolve().then(() => this.openStopsList?.focusFirst());
        },
        error: () => {
          this.deleting.set(false);
          const message = 'Não foi possível eliminar a parada. Tente novamente.';
          if (this.workflow.acceptFinishError(token, message)) {
            this.syncView();
            this.notification.error(message);
          }
        },
      });
  }

  finalizarParadaPorContexto(draft: FinalizacaoDraft): void {
    const snapshot = this.view();
    if (this.commandsBlocked() || !draft.endDate || !draft.endTime.trim()) {
      return;
    }
    if (!snapshot.area || !snapshot.workCenter) {
      this.notification.warning('Informe a Área de Produção e o Centro de Trabalho.');
      return;
    }
    const endDate = draft.endDate instanceof Date
      ? draft.endDate.toISOString()
      : draft.endDate.trim();
    const endTime = draft.endTime.trim();
    const fingerprint = [
      snapshot.area.code,
      snapshot.workCenter.code,
      endDate,
      endTime,
    ].join('|');
    if (this.contextFinishIdempotency?.fingerprint !== fingerprint) {
      this.contextFinishIdempotency = {
        fingerprint,
        key: this.idempotency.resolve(),
      };
    }
    this.contextFinishing.set(true);
    this.registrationError.set('');
    this.statusMessage.set('');

    this.service.finalizarParadaPorContexto({
      areaCode: snapshot.area.code,
      workCenterCode: snapshot.workCenter.code,
      endDate: draft.endDate,
      endTime,
      idempotencyKey: this.contextFinishIdempotency.key,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.contextFinishing.set(false);
        if (result.delivery.status === 'ERROR') {
          const message = result.delivery.error.userMessage;
          this.registrationError.set(message);
          this.notification.error(message);
          return;
        }
        if (result.delivery.status === 'SYNCED') {
          this.statusMessage.set('Finalização enviada ao Datasul.');
          this.notification.success('Finalização enviada ao Datasul.');
        } else {
          const message =
            'Datasul indisponível — finalização salva neste dispositivo e pendente de sincronização.';
          this.statusMessage.set(message);
          this.notification.warning(message);
        }
      },
      error: (error: unknown) => {
        this.contextFinishing.set(false);
        const message = error instanceof Error
          ? error.message
          : 'Não foi possível finalizar a parada. Os dados informados foram preservados.';
        this.registrationError.set(message);
        this.notification.error(message);
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
      this.notification.warning(
        'Selecione um responsável elegível para a Área e o Centro de Trabalho.',
      );
      return;
    }
    if (
      snapshot.draft.reasonId === null ||
      !snapshot.draft.startDate ||
      !snapshot.draft.startTime.trim()
    ) {
      this.notification.warning('Informe motivo, Data Inicial e Hora Inicial.');
      return;
    }

    const idempotencyKey = this.workflow.ensureIdempotencyKey(() => this.idempotency.resolve());
    this.workflow.setSaving(true);
    this.registrationError.set('');
    this.statusMessage.set('');
    this.syncView();

    this.service
      .registrarParada({
        areaCode: snapshot.area.code,
        workCenterCode: snapshot.workCenter.code,
        reasonId: snapshot.draft.reasonId,
        responsible,
        startDate: snapshot.draft.startDate,
        startTime: snapshot.draft.startTime,
        endDate: snapshot.draft.endDate,
        endTime: snapshot.draft.endTime,
        origin: snapshot.origin,
        metadata: snapshot.metadata,
        idempotencyKey,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stop) => {
          if (stop.delivery.status === 'ERROR') {
            this.workflow.setSaving(false);
            this.syncView();
            const message = stop.delivery.error.userMessage;
            this.registrationError.set(message);
            this.notification.error(message);
            return;
          }
          this.workflow.completeRegistration();
          this.syncView();
          if (stop.delivery.status === 'SYNCED') {
            this.statusMessage.set(
              `Parada ${stop.status === 'EM_ANDAMENTO' ? 'em andamento' : 'finalizada'} enviada ao Datasul.`,
            );
            this.notification.success('Parada enviada ao Datasul.');
          } else {
            this.statusMessage.set(
              `Datasul indisponível — parada ${stop.status === 'EM_ANDAMENTO' ? 'em andamento' : 'finalizada'} salva neste dispositivo e pendente de sincronização.`,
            );
            this.notification.warning(
              'Datasul indisponível — parada salva neste dispositivo e pendente de sincronização.',
            );
          }
          if (stop.status === 'EM_ANDAMENTO' && snapshot.area && snapshot.workCenter) {
            this.loadOpenStops(snapshot.area.code, snapshot.workCenter.code);
          }
        },
        error: (error: unknown) => {
          this.workflow.setSaving(false);
          this.syncView();
          const message =
            error instanceof Error
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

  private loadPrefill(prefill: ProductionContext, areasRequest: number): void {
    const area = this.areas().find((item) => this.sameCode(item.code, prefill.area.code));
    if (
      !area ||
      !prefill.workCenter.active ||
      !this.sameCode(prefill.workCenter.areaCode, area.code)
    ) {
      this.clearPendingPrefill();
      return;
    }
    const request = ++this.centersRequest;
    this.loadingCenters.set(true);
    this.service
      .pesquisarCentros(area.code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (centers) => {
          if (areasRequest !== this.areasRequest || request !== this.centersRequest) {
            return;
          }
          this.loadingCenters.set(false);
          this.centers.set(centers.map((center) => ({ ...center })));
          const center = centers.find(
            (item) =>
              item.active &&
              this.sameCode(item.code, prefill.workCenter.code) &&
              this.sameCode(item.areaCode, area.code),
          );
          if (!center) {
            this.clearPendingPrefill();
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
                  this.clearPendingPrefill();
                  return;
                }
                this.clearPendingPrefill();
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
    this.clearPendingPrefill();
    this.centersRequest += 1;
    this.centers.set([]);
    this.loadingCenters.set(false);
    this.pageError.set('');
    this.registrationError.set('');
    this.statusMessage.set('');
    this.workflow.confirmAreaChange(area);
    if (area) {
      this.areaCode.set(area.code);
    }
    this.syncView();
  }

  private loadCenters(areaCode: string, prefillCode = ''): void {
    const request = ++this.centersRequest;
    this.loadingCenters.set(true);
    this.service
      .pesquisarCentros(areaCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (centers) => {
          if (
            request !== this.centersRequest ||
            !this.sameCode(this.areaCode(), areaCode)
          ) {
            return;
          }
          this.centers.set(
            centers
              .filter((center) => center.active && this.sameCode(center.areaCode, areaCode))
              .map((center) => ({ ...center })),
          );
          this.loadingCenters.set(false);
          const available = this.centers();
          if (!available.length) {
            this.areas.set([]);
            this.workflow.confirmAreaChange(null);
            this.pageError.set(`Área de Produção ${areaCode} não encontrada ou sem Centros de Trabalho disponíveis.`);
            this.notification.warning(this.pageError());
            this.syncView();
            return;
          }
          const firstCenter = available[0];
          const area = { code: areaCode, description: firstCenter.area || `Área ${areaCode}` };
          this.areas.set([area]);
          this.workflow.confirmAreaChange(area);
          const prefill = available.find(center => this.sameCode(center.code, prefillCode)) ?? null;
          if (prefill) {
            this.workflow.confirmWorkCenterChange(prefill);
            this.loadContextData(areaCode, prefill.code);
          }
          this.pageError.set('');
          this.syncView();
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
            const center = this.centers().find(item => this.sameCode(item.code, workCenterCode));
            if (center) {
              this.recentContextService.remember(areaCode);
              this.recentContexts.set(this.recentContextService.list());
            }
            this.syncView();
            this.loadOpenStops(areaCode, workCenterCode);
          }
        },
        error: () => {
          if (
            this.workflow.acceptContextError(
              token,
              'Não foi possível carregar responsáveis e motivos. Tente novamente.',
            )
          ) {
            this.syncView();
          }
        },
      });
  }

  private loadOpenStops(areaCode: string, workCenterCode: string): void {
    const token = this.workflow.beginOpenStopsQuery(areaCode, workCenterCode);
    this.syncView();
    this.service
      .listarParadasEmAndamento(areaCode, workCenterCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stops) => {
          if (this.workflow.acceptOpenStops(token, stops)) {
            this.syncView();
          }
        },
        error: () => {
          if (
            this.workflow.acceptOpenStopsError(
              token,
              'Não foi possível consultar as paradas em andamento. Tente novamente.',
            )
          ) {
            this.syncView();
          }
        },
      });
  }

  private confirmDiscardIfNeeded(action: () => void): void {
    if (!this.view().dirty && !this.view().finishDirty) {
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
    return snapshot.responsibles.find(
      (item) =>
        item.tipo === snapshot.responsibleType &&
        this.sameCode(item.codigo, snapshot.responsibleCode),
    );
  }

  private syncView(): void {
    this.view.set(this.workflow.snapshot());
  }

  private sameCode(left: string, right: string): boolean {
    return left.trim().toUpperCase() === right.trim().toUpperCase();
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private commandsBlocked(): boolean {
    return this.view().saving || this.view().finishing || this.contextFinishing();
  }

  private clearPendingPrefill(): void {
    this.pendingPrefill = null;
    this.service.clearPrefillContext();
  }
}
